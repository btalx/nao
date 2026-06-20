import z from 'zod/v3';

export const ChartTypeEnum = z.enum([
	'bar',
	'stacked_bar',
	'line',
	'area',
	'stacked_area',
	'pie',
	'kpi_card',
	'scatter',
	'radar',
]);

/** The chart types that nao renders natively with Recharts. */
export const BUILTIN_CHART_TYPES = ChartTypeEnum.options as readonly ChartType[];

/**
 * True when `chartType` is one of the natively supported chart types.
 *
 * Any other string is treated as a custom chart plugin defined in the project's
 * `agent/charts/` folder and rendered on the client by dynamically importing the
 * matching plugin module.
 */
export function isBuiltinChartType(chartType: string): chartType is ChartType {
	return (BUILTIN_CHART_TYPES as readonly string[]).includes(chartType);
}

export const XAxisTypeEnum = z.enum(['date', 'number', 'category']);

export const SeriesConfigSchema = z.object({
	data_key: z.string().describe('Column name from SQL result to plot.'),
	color: z.string().describe('CSS color (defaults to theme colors).').optional(),
	label: z.string().describe('Label to display in the legend.').optional(),
});

export const InputSchema = z.object({
	query_id: z.string().describe("The id of a previous `execute_sql` tool call's output to get data from."),
	chart_type: z
		.string()
		.describe(
			`Type of chart to display. Built-in types: ${BUILTIN_CHART_TYPES.join(', ')}. ` +
				'You may also pass the name of a custom chart plugin defined in the project (see the "Custom charts" section of your instructions, if present).',
		),
	x_axis_key: z.string().describe('Column name for X-axis/category labels.'),
	x_axis_type: XAxisTypeEnum.nullable().describe(
		'Use "date" only when x-axis values parse as JS Date (YYYY-MM-DD). Use "category" for quarter_ending, fiscal periods, or labels. Use "number" for numeric x-axis.',
	),
	series: z
		.array(SeriesConfigSchema)
		.min(1)
		.describe('Columns to plot as data series (at least one series required).'),
	title: z
		.string()
		.describe(
			'A concise and descriptive title of what the chart shows. Do not include the type of chart in the title or other chart configurations.',
		),
});

export const OutputSchema = z.object({
	_version: z.literal('1').optional(),
	success: z.boolean(),
	error: z.string().optional(),
});

export type ChartType = z.infer<typeof ChartTypeEnum>;
export type XAxisType = z.infer<typeof XAxisTypeEnum>;
export type SeriesConfig = z.infer<typeof SeriesConfigSchema>;
export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema>;
