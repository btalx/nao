import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as userQueries from '../queries/user.queries';
import * as gitlabService from '../services/gitlab';
import { protectedProcedure } from './trpc';

export const gitlabRoutes = {
	isAvailable: protectedProcedure.query(() => {
		return gitlabService.isGitlabIntegrationAvailable();
	}),

	getStatus: protectedProcedure.query(async ({ ctx }) => {
		const token = await userQueries.getGitlabToken(ctx.user.id);
		if (!token) {
			return { connected: false as const };
		}

		try {
			const user = await gitlabService.getUser(token);
			return { connected: true as const, user: { username: user.username, avatarUrl: user.avatar_url } };
		} catch {
			return { connected: false as const };
		}
	}),

	disconnect: protectedProcedure.mutation(async ({ ctx }) => {
		await userQueries.updateGitlabToken(ctx.user.id, null);
	}),

	listProjects: protectedProcedure
		.input(z.object({ page: z.number().default(1), search: z.string().optional() }))
		.query(async ({ ctx, input }) => {
			const token = await userQueries.getGitlabToken(ctx.user.id);
			if (!token) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'GitLab is not connected' });
			}

			try {
				return await gitlabService.listProjects(token, { page: input.page, search: input.search });
			} catch (err) {
				throw new TRPCError({
					code: 'INTERNAL_SERVER_ERROR',
					message: err instanceof Error ? err.message : 'Failed to list projects',
				});
			}
		}),
};
