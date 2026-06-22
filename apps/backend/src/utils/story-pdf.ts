import type { DateFormatSettings } from '@nao/shared/date';

import { getBrowser } from './headless-browser';
import type { QueryDataMap, StoryInput } from './story-download';
import { generateStoryHtml } from './story-html';

export async function generateStoryPdf(
	story: StoryInput,
	queryData: QueryDataMap | null,
	dateFormat?: DateFormatSettings | null,
	customChartImages?: Map<string, string> | null,
): Promise<Buffer> {
	const html = generateStoryHtml(story, queryData, dateFormat, customChartImages);
	const browser = await getBrowser();
	const page = await browser.newPage();

	try {
		await page.setContent(html, { waitUntil: 'domcontentloaded' });
		const pdfBuffer = await page.pdf({
			format: 'A4',
			printBackground: true,
			margin: { top: '40px', bottom: '40px', left: '40px', right: '40px' },
		});
		return Buffer.from(pdfBuffer);
	} finally {
		await page.close();
	}
}
