import type { ChartPluginManifest } from '@nao/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod/v4';

import type { App } from '../app';
import { chartHotReloadEnabled } from '../env';
import { authMiddleware } from '../middleware/auth';
import { type ChartPluginReloadEvent, chartPluginService } from '../services/chart-plugin.service';
import { HandlerError } from '../utils/error';

const fileParamsSchema = z.object({
	file: z.string().regex(/^[a-zA-Z0-9_-]+\.(js|mjs)$/, 'Invalid plugin file name'),
});

/**
 * Serves custom chart plugins to the frontend (authenticated; the plugin set is
 * scoped to the requester's project):
 * - `GET /api/charts/plugins`        — manifest of available plugins
 * - `GET /api/charts/plugins/:file`  — a plugin's ES module source
 * - `GET /api/charts/events`         — SSE stream of hot-reload events
 */
export const chartPluginRoutes = async (app: App) => {
	app.addHook('preHandler', authMiddleware);

	app.get('/plugins', async (request): Promise<ChartPluginManifest> => {
		const projectId = await ensureInitialized(request);
		const plugins = chartPluginService.getPlugins(projectId).map(({ type, name, description, url }) => ({
			type,
			name,
			description,
			url,
		}));
		return { plugins, version: chartPluginService.getVersion(projectId), hotReload: chartHotReloadEnabled };
	});

	app.get('/plugins/:file', { schema: { params: fileParamsSchema } }, async (request, reply) => {
		const projectId = await ensureInitialized(request);
		const type = request.params.file.replace(/\.[^.]+$/, '');
		const source = chartPluginService.getPluginSource(projectId, type);
		if (source === null) {
			throw new HandlerError('NOT_FOUND', `Chart plugin "${type}" not found`);
		}
		return reply
			.header('Content-Type', 'text/javascript; charset=utf-8')
			.header('Cache-Control', 'no-store')
			.send(source);
	});

	app.get('/events', async (request, reply) => {
		if (!chartHotReloadEnabled) {
			return reply.status(204).send();
		}

		const projectId = await ensureInitialized(request);

		reply.raw.writeHead(200, {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
		});
		reply.raw.write(`event: ready\ndata: ${chartPluginService.getVersion(projectId)}\n\n`);

		const onReload = ({ projectId: changedProjectId, version }: ChartPluginReloadEvent) => {
			if (changedProjectId !== projectId) {
				return;
			}
			reply.raw.write(`event: reload\ndata: ${version}\n\n`);
		};
		chartPluginService.on('reload', onReload);

		const heartbeat = setInterval(() => {
			reply.raw.write(': ping\n\n');
		}, 25_000);

		request.raw.on('close', () => {
			clearInterval(heartbeat);
			chartPluginService.off('reload', onReload);
		});

		return reply.hijack();
	});
};

/**
 * Lazily initializes the plugin service against the authenticated request's
 * project so plugin source is only served for projects the caller can access.
 * Returns the resolved project id to scope every subsequent read.
 */
async function ensureInitialized(request: FastifyRequest): Promise<string> {
	if (!request.project) {
		throw new HandlerError('NOT_FOUND', 'No project configured for this user');
	}
	const projectId = request.project.id;
	await chartPluginService.initialize(projectId);
	return projectId;
}
