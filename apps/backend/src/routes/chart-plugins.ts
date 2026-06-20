import type { ChartPluginManifest } from '@nao/shared';
import { z } from 'zod/v4';

import type { App } from '../app';
import { chartHotReloadEnabled } from '../env';
import * as projectQueries from '../queries/project.queries';
import { chartPluginService } from '../services/chart-plugin.service';
import { HandlerError } from '../utils/error';

const fileParamsSchema = z.object({
	file: z.string().regex(/^[a-zA-Z0-9_-]+\.(js|mjs)$/, 'Invalid plugin file name'),
});

/**
 * Serves custom chart plugins to the frontend:
 * - `GET /api/charts/plugins`        — manifest of available plugins
 * - `GET /api/charts/plugins/:file`  — a plugin's ES module source
 * - `GET /api/charts/events`         — SSE stream of hot-reload events
 */
export const chartPluginRoutes = async (app: App) => {
	app.get('/plugins', async (): Promise<ChartPluginManifest> => {
		await ensureInitialized();
		const plugins = chartPluginService.getPlugins().map(({ type, name, description, url }) => ({
			type,
			name,
			description,
			url,
		}));
		return { plugins, version: chartPluginService.getVersion(), hotReload: chartHotReloadEnabled };
	});

	app.get('/plugins/:file', { schema: { params: fileParamsSchema } }, async (request, reply) => {
		await ensureInitialized();
		const type = request.params.file.replace(/\.[^.]+$/, '');
		const source = chartPluginService.getPluginSource(type);
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

		reply.raw.writeHead(200, {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
		});
		reply.raw.write(`event: ready\ndata: ${chartPluginService.getVersion()}\n\n`);

		const onReload = (version: number) => {
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
 * Lazily initializes the plugin service against the default (single) project so
 * the routes work before any agent run. Idempotent.
 */
async function ensureInitialized(): Promise<void> {
	const project = await projectQueries.getDefaultProject();
	await chartPluginService.initialize(project?.id);
}
