import type { SeriesConfig, XAxisType } from './tools/display-chart';

/**
 * Custom chart plugins ("vibe coded charts").
 *
 * A plugin is a plain ES module that lives in the project's `agent/charts/`
 * folder (e.g. `agent/charts/bubble.js`). Its file name (without extension) is
 * the `chart_type` the agent passes to the `display_chart` tool. The frontend
 * dynamically imports the module at runtime and calls its `render` function, so
 * plugins must not import bare module specifiers — the libraries they need are
 * injected through {@link ChartPluginLibs}.
 */

/** Metadata a chart plugin can export to describe itself. */
export interface ChartPluginMeta {
	/** Human-readable name shown in the UI and offered to the agent. */
	name?: string;
	/** One-line explanation of what the chart shows and when to use it. */
	description?: string;
}

/** An entry in the chart plugin manifest served by the backend. */
export interface ChartPluginManifestEntry {
	/** The `chart_type` the agent uses to select this plugin (file name without extension). */
	type: string;
	name: string;
	description: string;
	/** URL (relative to the server origin) to dynamically import the plugin module from. */
	url: string;
}

export interface ChartPluginManifest {
	plugins: ChartPluginManifestEntry[];
	/** Bumped whenever any plugin file changes; used to bust the dynamic import cache. */
	version: number;
	/** Whether the server watches plugins and emits hot-reload events. */
	hotReload: boolean;
}

/** Resolved chart configuration passed to a plugin's render function. */
export interface ChartPluginConfig {
	chartType: string;
	xAxisKey: string;
	xAxisType: XAxisType | null;
	series: SeriesConfig[];
	title?: string;
}

/**
 * Libraries injected into a chart plugin so it can render without bundling or
 * importing bare module specifiers. Vanilla-JS plugins can ignore these and
 * manipulate the DOM element directly.
 */
export interface ChartPluginLibs {
	/** The React namespace (`React.createElement`, hooks, ...). */
	React: unknown;
	/** `react-dom/client` (`createRoot`). */
	ReactDOM: unknown;
	/** The full Recharts namespace (`BarChart`, `Bar`, `ResponsiveContainer`, ...). */
	Recharts: unknown;
}

/** Context passed to a chart plugin's `render` function. */
export interface ChartPluginRenderContext {
	/** Rows returned by the source `execute_sql` query. */
	data: Record<string, unknown>[];
	/** The chart configuration chosen by the agent. */
	config: ChartPluginConfig;
	/** Injected libraries (React, ReactDOM, Recharts). */
	libs: ChartPluginLibs;
	/** Active UI theme. */
	theme: 'light' | 'dark';
	/** The default nao color palette (CSS color strings). */
	colors: string[];
}

/** The cleanup callback a plugin may return to tear down listeners/roots. */
export type ChartPluginCleanup = void | (() => void);

/**
 * A chart plugin module. Exports a `render` function and, optionally, `meta`.
 */
export interface ChartPluginModule {
	meta?: ChartPluginMeta;
	/**
	 * Render the chart into `element`. May return (or resolve to) a cleanup
	 * function that runs before the next render or when the chart unmounts.
	 */
	render: (
		element: HTMLElement,
		context: ChartPluginRenderContext,
	) => ChartPluginCleanup | Promise<ChartPluginCleanup>;
}
