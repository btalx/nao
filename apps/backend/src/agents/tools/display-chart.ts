import { isBuiltinChartType } from '@nao/shared';
import { displayChart } from '@nao/shared/tools';

import { DisplayChartOutput, renderToModelOutput } from '../../components/tool-outputs';
import { chartPluginService } from '../../services/chart-plugin.service';
import { createTool } from '../../utils/tools';

export default createTool<displayChart.Input, displayChart.Output>({
	description: 'Display a chart visualization of the data from a previous `execute_sql` tool call.',
	inputSchema: displayChart.InputSchema,
	outputSchema: displayChart.OutputSchema,

	execute: async (input, context) => {
		const { chart_type: chartType, x_axis_key: xAxisKey, series } = input;

		// Validate series is not empty (applies to every chart type)
		if (series.length === 0) {
			return { _version: '1', success: false, error: 'At least one series is required.' };
		}

		// Custom chart plugins (agent/charts/) define their own data expectations,
		// so skip the built-in shape validation and only check the plugin exists.
		if (!isBuiltinChartType(chartType)) {
			if (!chartPluginService.hasPlugin(chartType)) {
				const available = chartPluginService
					.getPlugins()
					.map((p) => p.type)
					.join(', ');
				return {
					_version: '1',
					success: false,
					error:
						`Unknown chart type "${chartType}". Use a built-in type or a custom chart plugin defined in agent/charts/.` +
						(available ? ` Available custom charts: ${available}.` : ''),
				};
			}
			context.generatedArtifacts.charts.push(input);
			return { _version: '1', success: true };
		}

		// Validate xAxisKey is provided for cartesian and polar charts
		if (['bar', 'line', 'area', 'stacked_area', 'scatter', 'radar'].includes(chartType) && !xAxisKey) {
			return { _version: '1', success: false, error: `xAxisKey is required for ${chartType} charts.` };
		}

		// Validate pie charts have exactly one series
		if (chartType === 'pie' && series.length !== 1) {
			return { _version: '1', success: false, error: 'Pie charts require exactly one series.' };
		}

		// Stacked charts require at least two series
		if ((chartType === 'stacked_bar' || chartType === 'stacked_area') && series.length < 2) {
			return {
				_version: '1',
				success: false,
				error: `Stacked ${chartType === 'stacked_bar' ? 'bar' : 'area'} chart requires at least two series. You may need to pivot the data to create a series for each stack.`,
			};
		}

		context.generatedArtifacts.charts.push(input);
		return { _version: '1', success: true };
	},

	toModelOutput: ({ output }) => renderToModelOutput(DisplayChartOutput({ output }), output),
});
