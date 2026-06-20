import { useSyncExternalStore } from 'react';
import { isBuiltinChartType } from '@nao/shared';
import type { ChartPluginManifest, ChartPluginModule } from '@nao/shared';

/**
 * Client-side registry for custom chart plugins ("vibe coded charts").
 *
 * Plugins are plain ES modules served by the backend from the project's
 * `agent/charts/` folder. We dynamically import them at runtime (so they work
 * in both the Vite dev server and the production binary) and, when the backend
 * reports hot reload is enabled, subscribe to a server-sent event stream that
 * bumps a version counter whenever a plugin file changes — re-importing the
 * module with a cache-busting query string.
 */

const MANIFEST_URL = '/api/charts/plugins';
const EVENTS_URL = '/api/charts/events';

let manifestPromise: Promise<ChartPluginManifest> | null = null;
let version = 0;
let eventSource: EventSource | null = null;
const listeners = new Set<() => void>();

function notify(): void {
	for (const listener of listeners) {
		listener();
	}
}

export { isBuiltinChartType };

export async function getChartPluginManifest(): Promise<ChartPluginManifest> {
	if (!manifestPromise) {
		manifestPromise = fetchManifest();
	}
	return manifestPromise;
}

async function fetchManifest(): Promise<ChartPluginManifest> {
	const response = await fetch(MANIFEST_URL);
	if (!response.ok) {
		throw new Error(`Failed to load chart plugins (${response.status})`);
	}
	const manifest = (await response.json()) as ChartPluginManifest;
	version = manifest.version;
	if (manifest.hotReload) {
		connectEventStream();
	}
	return manifest;
}

function connectEventStream(): void {
	if (eventSource || typeof EventSource === 'undefined') {
		return;
	}
	eventSource = new EventSource(EVENTS_URL);
	eventSource.addEventListener('reload', (event) => {
		const next = Number((event as MessageEvent).data);
		if (Number.isFinite(next) && next !== version) {
			version = next;
			// A new manifest may include added/removed plugins.
			manifestPromise = null;
			notify();
		}
	});
}

/** Subscribes a React component to plugin hot-reload events; returns the current version. */
export function useChartPluginVersion(): number {
	return useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			// Fetching the manifest opens the hot-reload event stream (when enabled).
			void getChartPluginManifest();
			return () => listeners.delete(listener);
		},
		() => version,
		() => version,
	);
}

export function buildChartPluginUrl(type: string, pluginVersion: number): string {
	return `${MANIFEST_URL}/${encodeURIComponent(type)}.js?v=${pluginVersion}`;
}

/** Dynamically imports a chart plugin module, busting the cache with `pluginVersion`. */
export async function loadChartPlugin(type: string, pluginVersion: number): Promise<ChartPluginModule> {
	const url = buildChartPluginUrl(type, pluginVersion);
	const module = (await import(/* @vite-ignore */ url)) as Partial<ChartPluginModule>;
	if (typeof module.render !== 'function') {
		throw new Error(`Chart plugin "${type}" must export a \`render\` function.`);
	}
	return module as ChartPluginModule;
}
