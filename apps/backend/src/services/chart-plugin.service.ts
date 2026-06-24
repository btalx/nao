import { EventEmitter } from 'node:events';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync, watch } from 'node:fs';
import { join, sep } from 'node:path';

import type { ChartPluginManifestEntry } from '@nao/shared';
import { debounce } from '@nao/shared';

import { chartHotReloadEnabled } from '../env';
import * as projectQueries from '../queries/project.queries';
import { logger } from '../utils/logger';

/** Folder (relative to the project root) where custom chart plugins live. */
export const CHART_PLUGINS_DIR = join('agent', 'charts');

/** File extensions a chart plugin can use — browser-importable ES modules only. */
const PLUGIN_EXTENSIONS = ['.js', '.mjs'];

/** URL prefix the frontend imports plugin modules from. */
const PLUGIN_URL_PREFIX = '/api/charts/plugins';

export interface ChartPlugin extends ChartPluginManifestEntry {
	/** Absolute path of the plugin file on disk. */
	filePath: string;
	fileName: string;
}

/** Payload emitted on the `reload` event when a project's plugin files change. */
export interface ChartPluginReloadEvent {
	projectId: string;
	version: number;
}

/** Per-project plugin discovery state. Keeping state keyed by project avoids a
 * process-global singleton that concurrent requests for different projects
 * could switch between init and read (cross-tenant leak). */
interface ProjectPluginState {
	projectPath: string;
	pluginsFolderPath: string;
	/** Canonical (symlink-resolved) plugins folder, used for containment checks. */
	realFolderPath: string | null;
	plugins: ChartPlugin[];
	version: number;
	watcher: ReturnType<typeof watch> | null;
	debouncedReload: () => void;
}

/**
 * Discovers and serves custom chart plugins ("vibe coded charts") from a
 * project's `agent/charts/` folder. State is kept per project so plugin
 * metadata/source can never leak across projects, and plugin files are
 * containment-checked (symlink-resolved) before being read.
 */
class ChartPluginService extends EventEmitter {
	private _byProject = new Map<string, ProjectPluginState>();
	private _initPromises = new Map<string, Promise<void>>();

	constructor() {
		super();
		// One `reload` listener is added per open SSE client; lift the default cap.
		this.setMaxListeners(0);
	}

	/**
	 * Discovers plugins for `projectId`. Idempotent per project and retries
	 * after a transient failure rather than permanently disabling the service.
	 */
	public async initialize(projectId: string | undefined): Promise<void> {
		if (!projectId) {
			return;
		}
		const existing = this._initPromises.get(projectId);
		if (existing) {
			return existing;
		}
		const promise = this._initialize(projectId).catch((error) => {
			// Allow a later call to retry after a transient failure.
			this._initPromises.delete(projectId);
			throw error;
		});
		this._initPromises.set(projectId, promise);
		return promise;
	}

	private async _initialize(projectId: string): Promise<void> {
		const project = await projectQueries.retrieveProjectById(projectId);
		const state = this._byProject.get(projectId) ?? this._createState(projectId);
		this._byProject.set(projectId, state);

		state.projectPath = project.path || '';
		state.pluginsFolderPath = state.projectPath ? join(state.projectPath, CHART_PLUGINS_DIR) : '';
		this._loadPlugins(state);

		if (chartHotReloadEnabled && state.pluginsFolderPath) {
			this._setupFileWatcher(state);
		}
	}

	private _createState(projectId: string): ProjectPluginState {
		const state: ProjectPluginState = {
			projectPath: '',
			pluginsFolderPath: '',
			realFolderPath: null,
			plugins: [],
			version: 0,
			watcher: null,
			debouncedReload: () => {},
		};
		state.debouncedReload = debounce(() => {
			this._loadPlugins(state);
			state.version += 1;
			this.emit('reload', { projectId, version: state.version } satisfies ChartPluginReloadEvent);
		}, 500);
		return state;
	}

	public getPlugins(projectId: string): ChartPlugin[] {
		return this._byProject.get(projectId)?.plugins ?? [];
	}

	public getVersion(projectId: string): number {
		return this._byProject.get(projectId)?.version ?? 0;
	}

	public hasPlugin(projectId: string, type: string): boolean {
		return this.getPlugins(projectId).some((plugin) => plugin.type === type);
	}

	/** Returns the raw module source for a plugin type, or null if unknown. */
	public getPluginSource(projectId: string, type: string): string | null {
		const state = this._byProject.get(projectId);
		if (!state) {
			return null;
		}
		const plugin = state.plugins.find((p) => p.type === type);
		if (!plugin) {
			return null;
		}
		return this._readContainedFile(state, plugin.filePath, type);
	}

	private _loadPlugins(state: ProjectPluginState): void {
		try {
			if (!state.pluginsFolderPath || !existsSync(state.pluginsFolderPath)) {
				state.realFolderPath = null;
				state.plugins = [];
				return;
			}

			if (!statSync(state.pluginsFolderPath).isDirectory()) {
				logger.error(`Chart plugins path is not a directory: ${state.pluginsFolderPath}`, { source: 'agent' });
				state.realFolderPath = null;
				state.plugins = [];
				return;
			}

			// Reject a plugins folder that (via symlink) escapes the project root,
			// otherwise files outside the project could be discovered and served.
			const realProjectPath = realpathSync(state.projectPath);
			const realFolderPath = realpathSync(state.pluginsFolderPath);
			if (!isContained(realProjectPath, realFolderPath)) {
				logger.error(
					`Chart plugins folder resolves outside the project root; ignoring: ${state.pluginsFolderPath}`,
					{
						source: 'agent',
					},
				);
				state.realFolderPath = null;
				state.plugins = [];
				return;
			}

			state.realFolderPath = realFolderPath;
			const files = readdirSync(state.pluginsFolderPath).filter((file) =>
				PLUGIN_EXTENSIONS.some((ext) => file.endsWith(ext)),
			);
			state.plugins = files
				.map((file) => this._readPlugin(state, file))
				.filter((plugin): plugin is ChartPlugin => plugin !== null)
				.sort((a, b) => a.type.localeCompare(b.type));
		} catch (error) {
			logger.error(`Failed to load chart plugins: ${String(error)}`, { source: 'agent' });
			state.realFolderPath = null;
			state.plugins = [];
		}
	}

	private _readPlugin(state: ProjectPluginState, fileName: string): ChartPlugin | null {
		const filePath = join(state.pluginsFolderPath, fileName);
		const type = fileName.replace(/\.[^.]+$/, '');

		// Skip plugin files that resolve (via symlink) outside the plugins folder.
		const source = this._readContainedFile(state, filePath, type);
		if (source === null) {
			return null;
		}

		let name = humanize(type);
		let description = '';
		const meta = extractMeta(source);
		name = meta.name || name;
		description = meta.description || '';

		return {
			type,
			name,
			description,
			url: `${PLUGIN_URL_PREFIX}/${type}.js`,
			filePath,
			fileName,
		};
	}

	/**
	 * Reads a file only if its canonical path is contained within the project's
	 * plugins folder, defeating symlink traversal that could otherwise disclose
	 * arbitrary host files through the plugin-source endpoint.
	 */
	private _readContainedFile(state: ProjectPluginState, filePath: string, type: string): string | null {
		try {
			if (!state.realFolderPath) {
				return null;
			}
			const realFile = realpathSync(filePath);
			if (!isContained(state.realFolderPath, realFile)) {
				logger.error(`Chart plugin "${type}" resolves outside the plugins folder; refusing to read.`, {
					source: 'agent',
				});
				return null;
			}
			return readFileSync(realFile, 'utf8');
		} catch (error) {
			logger.error(`Failed to read chart plugin "${type}": ${String(error)}`, { source: 'agent' });
			return null;
		}
	}

	private _setupFileWatcher(state: ProjectPluginState): void {
		state.watcher?.close();
		state.watcher = null;
		if (!state.pluginsFolderPath || !existsSync(state.pluginsFolderPath)) {
			return;
		}
		try {
			state.watcher = watch(state.pluginsFolderPath, { recursive: true }, (eventType) => {
				if (eventType === 'change' || eventType === 'rename') {
					state.debouncedReload();
				}
			});
		} catch (error) {
			logger.error(`Chart plugins file watcher setup failed: ${String(error)}`, { source: 'agent' });
		}
	}
}

/** True when `file` is the directory itself or sits inside it. */
function isContained(dir: string, file: string): boolean {
	return file === dir || file.startsWith(dir + sep);
}

/** Turns a plugin file name into a readable default name ("revenue_bubble" -> "Revenue Bubble"). */
function humanize(value: string): string {
	return value
		.replace(/[-_]+/g, ' ')
		.replace(/\b\w/g, (char) => char.toUpperCase())
		.trim();
}

/**
 * Extracts `name` and `description` from a plugin's `export const meta = {...}`
 * without executing the module. Tolerates single/double/back-tick quotes.
 */
function extractMeta(source: string): { name?: string; description?: string } {
	const metaMatch = source.match(/export\s+const\s+meta\s*=\s*\{([\s\S]*?)\}/);
	if (!metaMatch) {
		return {};
	}
	const body = metaMatch[1];
	return {
		name: extractStringField(body, 'name'),
		description: extractStringField(body, 'description'),
	};
}

function extractStringField(body: string, field: string): string | undefined {
	// Matches `field: '...'`, `field: "..."` or `field: ` + backtick string.
	const match = body.match(new RegExp(field + '\\s*:\\s*([\'"`])((?:\\\\.|(?!\\1).)*)\\1'));
	return match ? match[2].replace(/\\(['"`])/g, '$1') : undefined;
}

export const chartPluginService = new ChartPluginService();
