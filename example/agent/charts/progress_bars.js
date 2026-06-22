/**
 * Example custom chart plugin: a dependency-free, vanilla-JS chart.
 *
 * This plugin does not use any of the injected libraries — it just renders DOM
 * into the provided `element`. Use this style for lightweight visuals or to pull
 * in another charting library (e.g. via a CDN ES module import).
 *
 * Data contract:
 *   - config.xAxisKey  -> column used as the row label
 *   - config.series[0] -> column used as the value
 */

export const meta = {
	name: 'Progress bars',
	description:
		'A compact horizontal bar ranking. Good for "top N" lists by a single metric. Uses x_axis_key as the row label and the first series as the value.',
};

export function render(element, ctx) {
	const { data, config, colors, theme } = ctx;
	const labelKey = config.xAxisKey;
	const valueKey = config.series[0] && config.series[0].data_key;
	const textColor = theme === 'dark' ? '#e5e7eb' : '#111827';
	const mutedColor = theme === 'dark' ? '#9ca3af' : '#6b7280';

	const values = data.map((row) => Number(row[valueKey]) || 0);
	const max = Math.max(...values, 0) || 1;

	const wrapper = document.createElement('div');
	wrapper.style.cssText = 'display:flex;flex-direction:column;gap:12px;width:100%;overflow-y:auto;padding:8px 4px;';

	let firstHead = null;

	data.forEach((row, index) => {
		const value = Number(row[valueKey]) || 0;
		const pct = Math.max(2, Math.round((value / max) * 100));

		const item = document.createElement('div');

		const head = document.createElement('div');
		head.style.cssText = `display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;color:${textColor};`;
		const label = document.createElement('span');
		label.textContent = String(row[labelKey]);
		const amount = document.createElement('span');
		amount.style.color = mutedColor;
		amount.textContent = value.toLocaleString();
		head.appendChild(label);
		head.appendChild(amount);
		if (!firstHead) firstHead = head;

		const track = document.createElement('div');
		track.style.cssText = 'height:10px;border-radius:9999px;background:rgba(127,127,127,0.15);overflow:hidden;';
		const fill = document.createElement('div');
		fill.style.cssText = `height:100%;width:${pct}%;border-radius:9999px;background:${colors[index % colors.length]};transition:width .3s ease;`;
		track.appendChild(fill);

		item.appendChild(head);
		item.appendChild(track);
		wrapper.appendChild(item);
	});

	element.appendChild(wrapper);

	const headHeight = firstHead ? firstHead.offsetHeight : 0;
	wrapper.style.maxHeight = `calc(100% - ${headHeight}px - 20px)`;
	// No cleanup needed — nao clears the container before the next render.
}
