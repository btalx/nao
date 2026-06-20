---
description: Create, debug, or extend custom nao chart plugins ("vibe coded charts") that live in a project's agent/charts/ folder
---

# Custom chart plugins ("vibe coded charts")

nao ships a fixed set of built-in chart types (bar, line, area, pie, scatter,
radar, kpi_card, …). Projects can add their **own** chart types by dropping ES
module files into `agent/charts/`. Each file is a chart "plugin": the agent can
select it through the normal `display_chart` tool, and the frontend renders it
by dynamically importing the module at runtime.

Use this skill whenever a user asks to "make a new chart type", "vibe code a
chart", or to extend/debug an existing plugin in `agent/charts/`.

## How it works (end to end)

1. A plugin file lives at `<project>/agent/charts/<type>.js`. The file name
   (without extension) is the `chart_type`. Example: `agent/charts/bubble.js`
   defines the `bubble` chart type.
2. The backend discovers plugins (`chartPluginService`), lists them to the agent
   in the system prompt, and serves their source at
   `/api/charts/plugins/<type>.js`. The manifest is at `/api/charts/plugins`.
3. The agent calls `display_chart` with `chart_type: "<type>"` plus the usual
   `query_id`, `x_axis_key`, and `series`. Data still comes from a prior
   `execute_sql` result, exactly like built-in charts.
4. The frontend's `CustomChart` component dynamically imports the module and
   calls its `render(element, ctx)` function.
5. When running locally via `nao chat`, edits to plugin files **hot reload** in
   the browser. (Hot reload is not needed/active for Docker deployments.)

## Plugin contract

A plugin is a plain ES module. It must not `import` bare specifiers (there is no
bundler at runtime) — the libraries it needs are injected via `ctx.libs`.

```js
// agent/charts/<type>.js

// Optional metadata. `name` and `description` are shown to the agent so it
// knows when to pick this chart. Keep them simple string literals.
export const meta = {
	name: 'Bubble chart',
	description: 'Scatter plot where marker size encodes a third numeric series.',
};

// Required. Render into `element`. Optionally return a cleanup function.
export function render(element, ctx) {
	// ctx.data    -> array of rows from the source SQL query
	// ctx.config  -> { chartType, xAxisKey, xAxisType, series, title }
	// ctx.libs    -> { React, ReactDOM, Recharts }
	// ctx.theme   -> 'light' | 'dark'
	// ctx.colors  -> default nao color palette (array of hex strings)
	// return () => {/* teardown */}  (optional)
}
```

`ctx.config.series` is an array of `{ data_key, color?, label? }`. Map your
chart's dimensions onto `xAxisKey` + `series` so the agent can configure it with
the standard tool inputs.

## Two ways to render

**Vanilla JS / DOM** — ignore `ctx.libs` and build DOM directly. Best for
lightweight visuals or pulling another library from a CDN ES module URL
(`const d3 = await import('https://esm.sh/d3@7')`). See
`example/agent/charts/progress_bars.js`.

**React / Recharts** — use the injected libs (no JSX; call
`React.createElement`, aliased as `h`):

```js
export function render(element, ctx) {
	const { React, ReactDOM, Recharts } = ctx.libs;
	const h = React.createElement;
	const root = ReactDOM.createRoot(element);
	root.render(h(Recharts.ResponsiveContainer, { width: '100%', height: '100%' }, /* ...chart... */));
	return () => root.unmount(); // important for React plugins
}
```

See `example/agent/charts/bubble.js` for a full Recharts example.

## Rules & gotchas

- The container is sized by the host. For Recharts, wrap charts in
  `ResponsiveContainer` with `width/height: '100%'`.
- Do **not** use JSX or TypeScript — files are served and imported as-is by the
  browser. Use `.js` or `.mjs` and `React.createElement`.
- Do **not** `import 'react'` / `import 'recharts'`. Use `ctx.libs`.
- React plugins MUST return a cleanup that calls `root.unmount()`.
- PNG export and server-side rendering are unavailable for custom charts (they
  render only in the browser); the UI hides the download button for them.
- Adding a plugin requires no code changes to nao itself and no server restart
  when hot reload is active.

## Where the system is implemented (for editing nao itself)

- Backend discovery/serving: `apps/backend/src/services/chart-plugin.service.ts`,
  `apps/backend/src/routes/chart-plugins.ts`
- Shared contract types: `apps/shared/src/chart-plugin.ts`
- Schema (relaxed `chart_type`): `apps/shared/src/tools/display-chart.ts`
- Frontend loader + hot reload: `apps/frontend/src/lib/chart-plugins.ts`
- Frontend renderer: `apps/frontend/src/components/tool-calls/custom-chart.tsx`,
  integrated in `apps/frontend/src/components/tool-calls/display-chart.tsx`
- Agent guidance: `apps/backend/src/components/ai/system-prompt.tsx`

## Verifying a new plugin

1. Add `agent/charts/<type>.js` to the project folder.
2. Confirm it appears in the manifest: `GET /api/charts/plugins`.
3. In chat, run a query then ask for the chart, or set `chart_type` to `<type>`
   in a story `<chart … />` tag.
4. With `nao chat` running, edit the file and confirm the chart hot reloads.
