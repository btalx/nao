import '../src/env';

import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import * as sqliteSchema from '../src/db/sqlite-schema';
import { account, user } from '../src/db/sqlite-schema';

const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('../src/db/db', () => ({ db: holder.db }));

const testDb = drizzle('./db.sqlite', { schema: sqliteSchema });
holder.db = testDb;

const { getUserIdsWithPassword, userHasPassword } = await import('../src/queries/account.queries');

const PASSWORD_USER = 'acct-pwd-user';
const SSO_USER = 'acct-sso-user';
const NO_ACCOUNT_USER = 'acct-none-user';
const ALL_USER_IDS = [PASSWORD_USER, SSO_USER, NO_ACCOUNT_USER];

async function cleanup() {
	await testDb.delete(account).where(inArray(account.userId, ALL_USER_IDS));
	await testDb.delete(user).where(inArray(user.id, ALL_USER_IDS));
}

describe('credential account queries', () => {
	afterEach(cleanup);
	afterAll(() => testDb.$client.close());

	async function seed() {
		await cleanup();
		await testDb.insert(user).values([
			{ id: PASSWORD_USER, name: 'Pwd', email: 'pwd@example.com' },
			{ id: SSO_USER, name: 'Sso', email: 'sso@example.com' },
			{ id: NO_ACCOUNT_USER, name: 'None', email: 'none@example.com' },
		]);
		await testDb.insert(account).values([
			{
				id: 'acct-1',
				accountId: PASSWORD_USER,
				providerId: 'credential',
				userId: PASSWORD_USER,
				password: 'hashed',
			},
			{ id: 'acct-2', accountId: SSO_USER, providerId: 'google', userId: SSO_USER },
		]);
	}

	it('returns only users that own a credential account with a password', async () => {
		await seed();

		const ids = await getUserIdsWithPassword(ALL_USER_IDS);

		expect(ids.has(PASSWORD_USER)).toBe(true);
		expect(ids.has(SSO_USER)).toBe(false);
		expect(ids.has(NO_ACCOUNT_USER)).toBe(false);
	});

	it('ignores credential accounts without a password', async () => {
		await seed();
		await testDb.update(account).set({ password: null }).where(eq(account.userId, PASSWORD_USER));

		const ids = await getUserIdsWithPassword(ALL_USER_IDS);

		expect(ids.has(PASSWORD_USER)).toBe(false);
	});

	it('returns an empty set for no input', async () => {
		const ids = await getUserIdsWithPassword([]);
		expect(ids.size).toBe(0);
	});

	it('userHasPassword reflects credential account presence', async () => {
		await seed();

		expect(await userHasPassword(PASSWORD_USER)).toBe(true);
		expect(await userHasPassword(SSO_USER)).toBe(false);
		expect(await userHasPassword(NO_ACCOUNT_USER)).toBe(false);
	});
});
