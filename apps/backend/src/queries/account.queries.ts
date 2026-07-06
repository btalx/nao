import { and, eq, inArray, isNotNull } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';

const CREDENTIAL_PROVIDER_ID = 'credential';

export const getAccountById = async (userId: string): Promise<{ id: string; password: string | null } | null> => {
	const [account] = await db
		.select({ id: s.account.id, password: s.account.password })
		.from(s.account)
		.where(and(eq(s.account.userId, userId), eq(s.account.providerId, CREDENTIAL_PROVIDER_ID)))
		.execute();

	return account ?? null;
};

export const userHasPassword = async (userId: string): Promise<boolean> => {
	const account = await getAccountById(userId);
	return !!account?.password;
};

/**
 * Returns the subset of the given user ids that own a password (credential)
 * account. Users authenticated only through an identity provider (SSO) have no
 * such account, so password reset does not apply to them.
 */
export const getUserIdsWithPassword = async (userIds: string[]): Promise<Set<string>> => {
	if (userIds.length === 0) {
		return new Set();
	}

	const rows = await db
		.select({ userId: s.account.userId })
		.from(s.account)
		.where(
			and(
				inArray(s.account.userId, userIds),
				eq(s.account.providerId, CREDENTIAL_PROVIDER_ID),
				isNotNull(s.account.password),
			),
		)
		.execute();

	return new Set(rows.map((row) => row.userId));
};

export const updateAccountPassword = async (
	accountId: string,
	hashedPassword: string,
	userId: string,
	needToResetPassword = true,
): Promise<void> => {
	await db.transaction(async (tx) => {
		await tx.update(s.account).set({ password: hashedPassword }).where(eq(s.account.id, accountId)).execute();
		await tx
			.update(s.user)
			.set({ requiresPasswordReset: needToResetPassword })
			.where(eq(s.user.id, userId))
			.execute();
	});
};
