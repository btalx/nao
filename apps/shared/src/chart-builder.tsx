import React from 'react';
import {
	Area,
	AreaChart,
	Bar,
	BarChart,
	CartesianGrid,
	Customized,
	LabelList,
	Pie,
	PieChart,
	PolarAngleAxis,
	PolarGrid,
	PolarRadiusAxis,
	Radar,
	RadarChart,
	Scatter,
	ScatterChart,
	XAxis,
	YAxis,
} from 'recharts';

import { type DateFormatSettings, formatDateValue, isIsoDateLike } from './date';
import * as displayChart from './tools/display-chart';

export const DEFAULT_COLORS = ['#104e64', '#f54900', '#009689', '#ffb900', '#fe9a00'];

const AXIS_TICK = { fontSize: 12 };
const DATA_LABEL_PROPS = {
	fill: 'var(--foreground, #111827)',
	fontSize: 11,
	fontFamily: 'system-ui, sans-serif',
};
const DATA_LABEL_MARGIN_TOP = 18;
const DATA_LABEL_DOMAIN_PADDING = 0.1;
const MAX_LINE_AREA_DATA_LABELS = 12;

export function labelize(key: unknown, dateFormat?: DateFormatSettings | null): string {
	const str = String(key);
	if (isIsoDateLike(str)) {
		return formatDateValue(str, dateFormat);
	}
	return str.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatCompactNumber(value: number): string {
	const abs = Math.abs(value);
	if (abs >= 1_000_000_000) {
		return `${(value / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
	}
	if (abs >= 1_000_000) {
		return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
	}
	if (abs >= 10_000) {
		return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
	}
	return value.toLocaleString();
}

export function formatYAxisTick(value: number): string {
	return formatCompactNumber(value);
}

export function formatDataLabel(value: unknown): string {
	const number = toFiniteNumber(value);
	return number == null ? '' : formatCompactNumber(number);
}

export function defaultColorFor(_key: string, index: number): string {
	return DEFAULT_COLORS[index % DEFAULT_COLORS.length];
}

export interface BuildChartProps {
	data: Record<string, unknown>[];
	chartType: displayChart.ChartType;
	xAxisKey: string;
	xAxisType?: 'number' | 'category';
	series: displayChart.SeriesConfig[];
	colorFor?: (key: string, index: number) => string;
	labelFormatter?: (value: string) => string;
	showGrid?: boolean;
	children?: React.ReactNode[];
	margin?: { top?: number; right?: number; bottom?: number; left?: number };
	title?: string;
	maxXAxisTicks?: number;
	showDataLabels?: boolean;
}

/**
 * Builds a Recharts element tree from a display_chart tool config.
 *
 * Used by both the frontend (wrapped in ChartContainer + tooltips) and the
 * backend (rendered to SVG via renderToStaticMarkup for image generation).
 */
export function buildChart(props: BuildChartProps) {
	const resolved = buildResolved(props);

	if (resolved.chartType === 'kpi_card') {
		return buildKpiCard(resolved);
	}
	if (resolved.chartType === 'pie') {
		return buildPieChart(resolved);
	}
	if (resolved.chartType === 'line' || resolved.chartType === 'area' || resolved.chartType === 'stacked_area') {
		return buildAreaChart(resolved);
	}
	if (resolved.chartType === 'scatter') {
		return buildScatterChart(resolved);
	}
	if (resolved.chartType === 'radar') {
		return buildRadarChart(resolved);
	}
	return buildBarChart(resolved);
}

function buildResolved(props: BuildChartProps) {
	const colorFor = props.colorFor ?? defaultColorFor;
	const labelFormatter = props.labelFormatter ?? ((v: string) => labelize(v));

	const titleChild = props.title ? (
		<Customized
			key='chart-title'
			component={({ width = 0 }: { width?: number }) => (
				<text
					x={width / 2}
					y={16}
					textAnchor='middle'
					dominantBaseline='middle'
					fontSize={14}
					fontWeight='600'
					fontFamily='system-ui, sans-serif'
					fill='var(--foreground, #111827)'
				>
					{props.title}
				</text>
			)}
		/>
	) : null;

	const xAxisInterval =
		props.maxXAxisTicks && props.data.length > props.maxXAxisTicks
			? Math.ceil(props.data.length / props.maxXAxisTicks) - 1
			: undefined;

	const resolved: ResolvedProps = {
		...props,
		colorFor,
		labelFormatter,
		xAxisInterval,
		margin: buildChartMargin(props),
		children: titleChild ? [titleChild, ...(props.children ?? [])] : props.children,
	};
	return resolved;
}

type ResolvedProps = BuildChartProps &
	Required<Pick<BuildChartProps, 'colorFor' | 'labelFormatter'>> & { xAxisInterval?: number };

function buildChartMargin(props: BuildChartProps) {
	const titleTop = props.title ? 30 : 0;
	const labelsTop = shouldReserveDataLabelHeadroom(props) ? DATA_LABEL_MARGIN_TOP : 0;
	if (titleTop === 0 && labelsTop === 0) {
		return props.margin;
	}
	return { ...props.margin, top: (props.margin?.top ?? 0) + titleTop + labelsTop };
}

function shouldReserveDataLabelHeadroom(props: BuildChartProps): boolean {
	return (
		props.showDataLabels === true &&
		(props.chartType === 'bar' ||
			props.chartType === 'stacked_bar' ||
			props.chartType === 'line' ||
			props.chartType === 'area' ||
			props.chartType === 'stacked_area')
	);
}

function buildKpiCard(props: ResolvedProps) {
	const { data, series } = props;

	const kpis = series.map((s) => {
		const value = data[0]?.[s.data_key];
		return { value, displayName: s.label ?? s.data_key };
	});

	return (
		<KpiCardContainer>
			{kpis.map((kpi) => (
				<KpiCard value={kpi.value} displayName={kpi.displayName} />
			))}
		</KpiCardContainer>
	);
}

function KpiCardContainer({ children }: { children: React.ReactNode }) {
	return <div className='flex flex-wrap gap-4 w-full justify-start'>{children}</div>;
}

function KpiCard({ value, displayName }: { value: unknown; displayName: string }) {
	let formattedValue = '';

	if (typeof value === 'number') {
		formattedValue = formatCompactNumber(value);
	} else if (typeof value === 'string') {
		formattedValue = value;
	}

	return (
		<div className='min-w-[160px]'>
			<div className='text-lg tracking-wide'>{displayName}</div>
			<div className='text-3xl font-medium'>{formattedValue}</div>
		</div>
	);
}

function buildBarChart(props: ResolvedProps) {
	const {
		data,
		chartType,
		xAxisKey,
		xAxisType,
		series,
		colorFor,
		labelFormatter,
		showGrid,
		children,
		margin,
		xAxisInterval,
		showDataLabels,
	} = props;
	const isStacked = chartType === 'stacked_bar';
	const renderedSeries = getRenderedSeries(isStacked, series);
	const yAxisDomain = showDataLabels ? calculateYAxisDomain(data, renderedSeries, chartType) : undefined;
	const stackTotalLabel =
		showDataLabels && isStacked && renderedSeries.length > 0 ? renderStackTotalLabel(data, series) : undefined;
	const stackTotalLabelIndex = renderedSeries.length - 1;

	return (
		<BarChart data={data} accessibilityLayer margin={margin}>
			{showGrid && <CartesianGrid horizontal vertical={false} strokeDasharray='3 3' />}
			<YAxis
				tick={AXIS_TICK}
				tickLine={false}
				axisLine={false}
				minTickGap={12}
				tickFormatter={formatYAxisTick}
				domain={yAxisDomain}
			/>
			<XAxis
				dataKey={xAxisKey}
				type={xAxisType}
				domain={['dataMin', 'dataMax']}
				tick={AXIS_TICK}
				tickLine={true}
				tickMargin={10}
				axisLine={false}
				minTickGap={12}
				interval={xAxisInterval}
				tickFormatter={labelFormatter}
			/>
			{children}
			{renderedSeries.map((s, i) => (
				<Bar
					key={s.data_key}
					dataKey={s.data_key}
					fill={colorFor(s.data_key, i)}
					stackId={isStacked ? 'stack' : undefined}
					radius={getBarRadius(isStacked, i, renderedSeries.length)}
					isAnimationActive={false}
				>
					{showDataLabels && !isStacked && (
						<LabelList position='top' formatter={formatDataLabel} {...DATA_LABEL_PROPS} />
					)}
					{stackTotalLabel && i === stackTotalLabelIndex && <LabelList content={stackTotalLabel} />}
				</Bar>
			))}
		</BarChart>
	);
}

function buildAreaChart(props: ResolvedProps) {
	const {
		data,
		chartType,
		xAxisKey,
		xAxisType,
		series,
		colorFor,
		labelFormatter,
		showGrid,
		children,
		margin,
		xAxisInterval,
		showDataLabels,
	} = props;
	const isStacked = chartType === 'stacked_area';
	const renderedSeries = getRenderedSeries(isStacked, series);
	const yAxisDomain = showDataLabels ? calculateYAxisDomain(data, renderedSeries, chartType) : undefined;
	const stackTotalLabel =
		showDataLabels && isStacked && renderedSeries.length > 0 ? renderStackTotalLabel(data, series) : undefined;
	const stackTotalLabelIndex = renderedSeries.length - 1;
	const pointLabelContent = showDataLabels && !isStacked ? buildPointLabelContentBySeries(data, series) : new Map();

	return (
		<AreaChart data={data} accessibilityLayer margin={margin}>
			<defs>
				{renderedSeries.map((s, i) => {
					const color = colorFor(s.data_key, i);
					const gradientId = `grad-${i}`;
					return (
						<linearGradient key={s.data_key} id={gradientId} x1='0' y1='0' x2='0' y2='1'>
							<stop offset='0%' stopColor={color} stopOpacity={0.25} />
							<stop offset='100%' stopColor={color} stopOpacity={0} />
						</linearGradient>
					);
				})}
			</defs>
			{showGrid && <CartesianGrid horizontal vertical={false} strokeDasharray='3 3' />}
			<YAxis
				tick={AXIS_TICK}
				tickLine={false}
				axisLine={false}
				minTickGap={12}
				tickFormatter={formatYAxisTick}
				domain={yAxisDomain}
			/>
			<XAxis
				dataKey={xAxisKey}
				type={xAxisType}
				domain={['dataMin', 'dataMax']}
				tick={AXIS_TICK}
				tickLine
				tickMargin={10}
				axisLine={false}
				minTickGap={12}
				interval={xAxisInterval}
				tickFormatter={labelFormatter}
			/>
			{children}
			{renderedSeries.map((s, i) => (
				<Area
					key={s.data_key}
					dataKey={s.data_key}
					type='monotone'
					stroke={colorFor(s.data_key, i)}
					fill={`url(#grad-${i})`}
					stackId={isStacked ? 'stack' : undefined}
					isAnimationActive={false}
				>
					{showDataLabels && !isStacked && <LabelList content={pointLabelContent.get(s.data_key)} />}
					{stackTotalLabel && i === stackTotalLabelIndex && <LabelList content={stackTotalLabel} />}
				</Area>
			))}
		</AreaChart>
	);
}

function buildScatterChart(props: ResolvedProps) {
	const { data, xAxisKey, xAxisType, series, colorFor, showGrid, children, margin } = props;

	return (
		<ScatterChart data={data} accessibilityLayer margin={margin}>
			{showGrid && <CartesianGrid strokeDasharray='3 3' />}
			<XAxis
				dataKey={xAxisKey}
				type={xAxisType ?? 'number'}
				tick={AXIS_TICK}
				tickLine={false}
				axisLine={false}
				minTickGap={12}
			/>
			<YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={12} tickFormatter={formatYAxisTick} />
			{children}
			{series.map((s, i) => (
				<Scatter
					key={s.data_key}
					dataKey={s.data_key}
					fill={colorFor(s.data_key, i)}
					isAnimationActive={false}
				/>
			))}
		</ScatterChart>
	);
}

function buildRadarChart(props: ResolvedProps) {
	const { data, xAxisKey, series, colorFor, children, margin } = props;

	return (
		<RadarChart data={data} accessibilityLayer margin={margin}>
			<PolarGrid />
			<PolarAngleAxis dataKey={xAxisKey} tick={AXIS_TICK} />
			<PolarRadiusAxis tick={AXIS_TICK} tickFormatter={formatYAxisTick} />
			{children}
			{series.map((s, i) => (
				<Radar
					key={s.data_key}
					dataKey={s.data_key}
					stroke={colorFor(s.data_key, i)}
					fill={colorFor(s.data_key, i)}
					fillOpacity={0.3}
					isAnimationActive={false}
				/>
			))}
		</RadarChart>
	);
}

function buildPieChart(props: ResolvedProps) {
	const { data, xAxisKey, series, colorFor, labelFormatter, children, margin } = props;
	const dataKey = series[0].data_key;

	const uniqueValues = [...new Set(data.map((d) => String(d[xAxisKey])))];
	const colorMap = new Map(uniqueValues.map((v, i) => [v, colorFor(v, i)]));

	const dataWithColors = data.map((item) => ({
		...item,
		fill: colorMap.get(String(item[xAxisKey])) ?? DEFAULT_COLORS[0],
	}));

	return (
		<PieChart accessibilityLayer margin={margin}>
			<Pie
				data={dataWithColors}
				dataKey={dataKey}
				nameKey={xAxisKey}
				label={renderPieLabel(labelFormatter)}
				labelLine={false}
				isAnimationActive={false}
			/>
			{children}
		</PieChart>
	);
}

function renderPieLabel(labelFormatter: (v: string) => string) {
	return ({
		x,
		y,
		name,
		value,
		fill,
		textAnchor,
	}: {
		x: number;
		y: number;
		name: string;
		value: number;
		fill: string;
		textAnchor: 'start' | 'middle' | 'end';
	}) => (
		<text x={x} y={y} fill={fill} textAnchor={textAnchor} dominantBaseline='central' fontSize={12}>
			{`${labelFormatter(String(name))}: ${formatCompactNumber(value)}`}
		</text>
	);
}

type LabelCoordinate = number | string | undefined;

interface StackTotalLabelProps {
	x?: LabelCoordinate;
	y?: LabelCoordinate;
	width?: LabelCoordinate;
	index?: number;
}

interface PointLabelProps {
	x?: LabelCoordinate;
	y?: LabelCoordinate;
	value?: unknown;
	index?: number;
}

function buildPointLabelContentBySeries(data: Record<string, unknown>[], series: displayChart.SeriesConfig[]) {
	return new Map(series.map((item) => [item.data_key, renderPointLabel(getLabeledIndices(data, item.data_key))]));
}

function renderPointLabel(labeledIndices: Set<number>) {
	return ({ x, y, value, index }: PointLabelProps) => {
		const labelX = toFiniteNumber(x);
		const labelY = toFiniteNumber(y);
		if (labelX == null || labelY == null || index == null || !labeledIndices.has(index)) {
			return null;
		}

		const label = formatDataLabel(value);
		if (!label) {
			return null;
		}

		return (
			<text x={labelX} y={labelY - 6} textAnchor='middle' dominantBaseline='alphabetic' {...DATA_LABEL_PROPS}>
				{label}
			</text>
		);
	};
}

function getLabeledIndices(
	data: Record<string, unknown>[],
	dataKey: string,
	maxLabels = MAX_LINE_AREA_DATA_LABELS,
): Set<number> {
	if (data.length <= maxLabels) {
		return new Set(data.map((_, index) => index));
	}

	const points = getFiniteSeriesPoints(data, dataKey);
	const globalMax = getGlobalMaxPoint(points);
	if (globalMax == null) {
		return new Set();
	}

	const peaks = getLocalMaximumPoints(points);
	if (peaks.length === 0) {
		return new Set([globalMax.index]);
	}

	const peakByIndex = new Map(peaks.map((point) => [point.index, point]));
	peakByIndex.set(globalMax.index, globalMax);

	const selected = Array.from(peakByIndex.values())
		.sort((a, b) => b.value - a.value || a.index - b.index)
		.slice(0, maxLabels)
		.sort((a, b) => a.index - b.index);
	return new Set(selected.map((point) => point.index));
}

interface SeriesPoint {
	index: number;
	value: number;
}

function getFiniteSeriesPoints(data: Record<string, unknown>[], dataKey: string): SeriesPoint[] {
	return data.flatMap((row, index) => {
		const value = toFiniteNumber(row[dataKey]);
		return value == null ? [] : [{ index, value }];
	});
}

function getGlobalMaxPoint(points: SeriesPoint[]): SeriesPoint | null {
	return points.reduce<SeriesPoint | null>((maxPoint, point) => {
		if (maxPoint == null || point.value > maxPoint.value) {
			return point;
		}
		return maxPoint;
	}, null);
}

function getLocalMaximumPoints(points: SeriesPoint[]): SeriesPoint[] {
	const peaks: SeriesPoint[] = [];
	let runStart = 0;

	while (runStart < points.length) {
		let runEnd = runStart;
		while (runEnd + 1 < points.length && points[runEnd + 1].value === points[runStart].value) {
			runEnd += 1;
		}

		const value = points[runStart].value;
		const left = runStart > 0 ? points[runStart - 1].value : null;
		const right = runEnd + 1 < points.length ? points[runEnd + 1].value : null;
		if ((left == null || value > left) && (right == null || value > right)) {
			peaks.push(points[runStart]);
		}

		runStart = runEnd + 1;
	}

	return peaks;
}

function renderStackTotalLabel(data: Record<string, unknown>[], series: displayChart.SeriesConfig[]) {
	return ({ x, y, width, index }: StackTotalLabelProps) => {
		const labelX = getCenteredLabelX(x, width);
		const labelY = toFiniteNumber(y);
		if (labelX == null || labelY == null || index == null) {
			return null;
		}

		const total = sumStackValue(data[index], series);
		if (total == null) {
			return null;
		}

		return (
			<text x={labelX} y={labelY - 6} textAnchor='middle' dominantBaseline='alphabetic' {...DATA_LABEL_PROPS}>
				{formatCompactNumber(total)}
			</text>
		);
	};
}

function calculateYAxisDomain(
	data: Record<string, unknown>[],
	series: displayChart.SeriesConfig[],
	chartType: displayChart.ChartType,
): [number, number] | undefined {
	const extents =
		chartType === 'stacked_bar' || chartType === 'stacked_area'
			? calculateStackedChartExtents(data, series)
			: calculateSeriesExtents(data, series);
	if (!extents) {
		return undefined;
	}
	return padYAxisDomain(extents.min, extents.max);
}

function calculateSeriesExtents(data: Record<string, unknown>[], series: displayChart.SeriesConfig[]) {
	let min = Infinity;
	let max = -Infinity;

	for (const row of data) {
		for (const item of series) {
			const value = toFiniteNumber(row[item.data_key]);
			if (value != null) {
				min = Math.min(min, value);
				max = Math.max(max, value);
			}
		}
	}

	return min === Infinity ? null : { min, max };
}

function calculateStackedChartExtents(data: Record<string, unknown>[], series: displayChart.SeriesConfig[]) {
	const stackedSeries = series.filter((item) => !item.is_total);
	return stackedSeries.length > 0 ? calculateStackedExtents(data, stackedSeries) : null;
}

function calculateStackedExtents(data: Record<string, unknown>[], series: displayChart.SeriesConfig[]) {
	let min = 0;
	let max = 0;

	for (const row of data) {
		let positive = 0;
		let negative = 0;
		for (const item of series) {
			const value = toFiniteNumber(row[item.data_key]);
			if (value == null) {
				continue;
			}
			if (value >= 0) {
				positive += value;
			} else {
				negative += value;
			}
		}
		min = Math.min(min, negative);
		max = Math.max(max, positive);
	}

	return { min, max };
}

function padYAxisDomain(min: number, max: number): [number, number] {
	if (min === max) {
		const padding = Math.max(Math.abs(max) * DATA_LABEL_DOMAIN_PADDING, 1);
		return [Math.min(0, min - padding), Math.max(0, max + padding)];
	}

	const padding = (max - min) * DATA_LABEL_DOMAIN_PADDING;
	return [min < 0 ? min - padding : 0, max > 0 ? max + padding : 0];
}

function getRenderedSeries(isStacked: boolean, series: displayChart.SeriesConfig[]): displayChart.SeriesConfig[] {
	return isStacked ? series.filter((item) => !item.is_total) : series;
}

function getBarRadius(isStacked: boolean, index: number, seriesLength: number): [number, number, number, number] {
	if (!isStacked) {
		return [4, 4, 4, 4];
	}
	return index === seriesLength - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0];
}

function sumStackValue(row: Record<string, unknown> | undefined, series: displayChart.SeriesConfig[]): number | null {
	if (!row) {
		return null;
	}

	const values = series.filter((s) => !s.is_total).map((s) => toFiniteNumber(row[s.data_key]));
	const numericValues = values.filter((value): value is number => value != null);
	return numericValues.length > 0 ? numericValues.reduce((sum, value) => sum + value, 0) : null;
}

function getCenteredLabelX(x: LabelCoordinate, width: LabelCoordinate): number | null {
	const labelX = toFiniteNumber(x);
	if (labelX == null) {
		return null;
	}

	const labelWidth = toFiniteNumber(width);
	return labelWidth == null ? labelX : labelX + labelWidth / 2;
}

function toFiniteNumber(value: unknown): number | null {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : null;
	}
	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}
