/**
 * Example custom chart plugin: a Recharts-based bubble chart.
 *
 * Custom charts live in `agent/charts/`. The file name (here `bubble`) is the
 * `chart_type` the agent passes to the `display_chart` tool. nao imports this
 * module in the browser and calls `render(element, ctx)`, injecting the
 * libraries it needs through `ctx.libs` (no bundler / no bare imports).
 *
 * Data contract: `ctx.data` are the rows of the source SQL query, and
 * `ctx.config` is the chart config chosen by the agent:
 *   - config.xAxisKey      -> column for the X axis (numeric)
 *   - config.series[0]     -> first series, used for the Y axis
 *   - config.series[1]     -> optional series, used for the bubble size
 */

export const meta = {
	name: 'Bubble chart',
	description:
		'Scatter plot where the marker size encodes a third numeric series. Set x_axis_type to "number", pass the X column as x_axis_key, the Y column as the first series, and (optionally) the bubble-size column as a second series.',
};

export function render(element, ctx) {
	const { React, ReactDOM, Recharts } = ctx.libs;
	const { data, config, colors, theme } = ctx;
	const h = React.createElement;

	const xKey = config.xAxisKey;
	const yKey = config.series[0] && config.series[0].data_key;
	const sizeKey = config.series[1] && config.series[1].data_key;
	const color = (config.series[0] && config.series[0].color) || colors[0];
	const gridColor = theme === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)';

	const { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip } = Recharts;

	const chart = h(
		ResponsiveContainer,
		{ width: '100%', height: '100%' },
		h(
			ScatterChart,
			{ margin: { top: 16, right: 24, bottom: 24, left: 8 } },
			h(CartesianGrid, { strokeDasharray: '3 3', stroke: gridColor }),
			h(XAxis, { type: 'number', dataKey: xKey, name: xKey, tick: { fontSize: 12 }, tickLine: false }),
			h(YAxis, { type: 'number', dataKey: yKey, name: yKey, tick: { fontSize: 12 }, tickLine: false }),
			sizeKey ? h(ZAxis, { type: 'number', dataKey: sizeKey, range: [80, 700], name: sizeKey }) : null,
			h(Tooltip, { cursor: { strokeDasharray: '3 3' } }),
			h(Scatter, { data, fill: color, fillOpacity: 0.65 }),
		),
	);

	const root = ReactDOM.createRoot(element);
	root.render(chart);

	// Returned cleanup runs before re-render / unmount.
	return () => root.unmount();
}
