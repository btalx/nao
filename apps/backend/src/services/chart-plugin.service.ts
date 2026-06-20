import { EventEmitter } from 'node:events';
import { existsSync, readdirSync, readFileSync, statSync, watch } from 'node:fs';
import { join } from 'node:path';

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

/**
 * Discovers and serves custom chart plugins ("vibe coded charts") from a
 * project's `agent/charts/` folder. Mirrors {@link SkillService}: plugins are
 * loaded once per project, watched for changes, and exposed to both the agent
 * (via the system prompt) and the frontend (via the plugin routes).
 */
class ChartPluginService extends EventEmitter {
	private _projectPath = '';
	private _pluginsFolderPath = '';
	private _plugins: ChartPlugin[] = [];
	private _version = 0;
	private _fileWatcher: ReturnType<typeof watch> | null = null;
	private _debouncedReload: () => void;
	private _initialized = false;

	constructor() {
		super();
		this._debouncedReload = debounce(() => {
			this.loadPlugins();
			this._version += 1;
			this.emit('reload', this._version);
		}, 500);
	}

	public async initialize(projectId: string | undefined): Promise<void> {
		if (this._initialized || !projectId) {
			return;
		}
		this._initialized = true;

		try {
			const project = await projectQueries.retrieveProjectById(projectId);
			this._projectPath = project.path || '';
		} catch (error) {
			logger.warn(`Chart plugins: could not resolve project path: ${String(error)}`, { source: 'agent' });
			this._projectPath = '';
		}

		if (!this._projectPath) {
			return;
		}

		this._pluginsFolderPath = join(this._projectPath, CHART_PLUGINS_DIR);
		this.loadPlugins();

		if (chartHotReloadEnabled) {
			this._setupFileWatcher();
		}
	}

	public loadPlugins(): void {
		try {
			if (!this._pluginsFolderPath || !existsSync(this._pluginsFolderPath)) {
				this._plugins = [];
				return;
			}

			if (!statSync(this._pluginsFolderPath).isDirectory()) {
				logger.error(`Chart plugins path is not a directory: ${this._pluginsFolderPath}`, { source: 'agent' });
				this._plugins = [];
				return;
			}

			const files = readdirSync(this._pluginsFolderPath).filter((file) =>
				PLUGIN_EXTENSIONS.some((ext) => file.endsWith(ext)),
			);
			this._plugins = files.map((file) => this._readPlugin(file)).sort((a, b) => a.type.localeCompare(b.type));
		} catch (error) {
			logger.error(`Failed to load chart plugins: ${String(error)}`, { source: 'agent' });
			this._plugins = [];
		}
	}

	public getPlugins(): ChartPlugin[] {
		return this._plugins;
	}

	public getVersion(): number {
		return this._version;
	}

	public hasPlugin(type: string): boolean {
		return this._plugins.some((plugin) => plugin.type === type);
	}

	/** Returns the raw module source for a plugin type, or null if unknown. */
	public getPluginSource(type: string): string | null {
		const plugin = this._plugins.find((p) => p.type === type);
		if (!plugin) {
			return null;
		}
		try {
			return readFileSync(plugin.filePath, 'utf8');
		} catch (error) {
			logger.error(`Failed to read chart plugin "${type}": ${String(error)}`, { source: 'agent' });
			return null;
		}
	}

	private _readPlugin(fileName: string): ChartPlugin {
		const filePath = join(this._pluginsFolderPath, fileName);
		const type = fileName.replace(/\.[^.]+$/, '');

		let name = humanize(type);
		let description = '';
		try {
			const source = readFileSync(filePath, 'utf8');
			const meta = extractMeta(source);
			name = meta.name || name;
			description = meta.description || '';
		} catch (error) {
			logger.warn(`Failed to read chart plugin metadata for "${fileName}": ${String(error)}`, {
				source: 'agent',
			});
		}

		return {
			type,
			name,
			description,
			url: `${PLUGIN_URL_PREFIX}/${type}.js`,
			filePath,
			fileName,
		};
	}

	private _setupFileWatcher(): void {
		if (!this._pluginsFolderPath || !existsSync(this._pluginsFolderPath)) {
			return;
		}
		try {
			this._fileWatcher = watch(this._pluginsFolderPath, { recursive: true }, (eventType) => {
				if (eventType === 'change' || eventType === 'rename') {
					this._debouncedReload();
				}
			});
		} catch (error) {
			logger.error(`Chart plugins file watcher setup failed: ${String(error)}`, { source: 'agent' });
		}
	}
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
