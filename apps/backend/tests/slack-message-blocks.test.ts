import { describe, expect, it } from 'vitest';

import {
	balanceSlackStreamingCodeFence,
	buildSlackCardNotificationText,
	buildSlackTableBlocks,
	chunkSlackText,
	countHiddenTableNotices,
	createCompletionCard,
	createSlackTableRenderState,
	createStopButtonCard,
	createTextBlocks,
	formatSlackMessageText,
	isRecoverableSlackPayloadError,
	SLACK_SECTION_TEXT_MAX_CHARS,
} from '../src/utils/messaging-provider';

type AnyBlock = { type: string; [key: string]: unknown };

function textContents(blocks: ReturnType<typeof createTextBlocks>): string[] {
	return blocks
		.filter((block): block is Extract<(typeof blocks)[number], { type: 'text' }> => block.type === 'text')
		.map((block) => block.content);
}

function isMonospaceTableChunk(content: string): boolean {
	return content.startsWith('```\n') && content.endsWith('\n```');
}

function parseMonospaceTableChunk(content: string): { headers: string[]; rows: string[][] } {
	const lines = content.slice('```\n'.length, -'\n```'.length).split('\n');
	const columns = [...lines[1].matchAll(/-+/g)].map((match) => match.index ?? 0);
	const cells = (line: string) => columns.map((start, index) => line.slice(start, columns[index + 1]).trim());
	return { headers: cells(lines[0]), rows: lines.slice(2).map(cells) };
}

function monospaceTableChunks(blocks: ReturnType<typeof createTextBlocks>) {
	return textContents(blocks).filter(isMonospaceTableChunk).map(parseMonospaceTableChunk);
}

function monospaceTable(blocks: ReturnType<typeof createTextBlocks>) {
	const chunks = monospaceTableChunks(blocks);
	if (chunks.length === 0) {
		return undefined;
	}
	return { headers: chunks[0].headers, rows: chunks.flatMap((chunk) => chunk.rows) };
}

function sectionTexts(blocks: AnyBlock[]): string[] {
	return blocks
		.filter((block) => block.type === 'section')
		.map((block) => (block as { text?: { text: string } }).text?.text ?? '');
}

function reconstructChunkedText(chunks: string[]): string {
	return chunks
		.map((chunk, index) => {
			let sourceChunk = chunk;
			if (index > 0 && chunks[index - 1].endsWith('\n```') && sourceChunk.startsWith('```\n')) {
				sourceChunk = sourceChunk.slice(4);
			}
			if (index < chunks.length - 1 && sourceChunk.endsWith('\n```') && chunks[index + 1].startsWith('```\n')) {
				sourceChunk = sourceChunk.slice(0, -4);
			}
			return sourceChunk;
		})
		.join('');
}

function tripleBacktickCount(text: string): number {
	return text.split('\n').filter((line) => line.trimStart().startsWith('```')).length;
}

describe('createTextBlocks', () => {
	it('returns a single text block when there is no table', () => {
		const blocks = createTextBlocks('Just a plain answer with **bold**.');
		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toMatchObject({ type: 'text', content: 'Just a plain answer with *bold*.' });
	});

	it('splits oversized text into Slack-safe sections', () => {
		const blocks = createTextBlocks('x'.repeat(5000));

		expect(blocks.length).toBeGreaterThan(1);
		expect(blocks.every((block) => block.type === 'text')).toBe(true);
		expect(
			blocks.every((block) => block.type !== 'text' || block.content.length <= SLACK_SECTION_TEXT_MAX_CHARS),
		).toBe(true);
	});

	it('keeps a long fenced SQL block balanced across Slack sections', () => {
		const sqlLines = Array.from(
			{ length: 240 },
			(_, index) => `    SELECT ${index} AS row_${index}, '${'value '.repeat(8)}' AS description;`,
		);
		const source = ['Before the query.', '', '```sql', ...sqlLines, '```', '', 'After the query.'].join('\n');
		const chunks = textContents(createTextBlocks(source));
		const codeChunks = chunks.filter((chunk) => chunk.includes('```'));

		expect(chunks.length).toBeGreaterThanOrEqual(3);
		expect(chunks.every((chunk) => chunk.length <= SLACK_SECTION_TEXT_MAX_CHARS)).toBe(true);
		expect(codeChunks.every((chunk) => tripleBacktickCount(chunk) % 2 === 0)).toBe(true);
		expect(codeChunks[0]).toContain('```sql');
		expect(codeChunks.slice(1).every((chunk) => chunk.startsWith('```\n'))).toBe(true);
		expect(codeChunks.slice(1).every((chunk) => !chunk.startsWith('```sql'))).toBe(true);
		expect(codeChunks.slice(1, -1).every((chunk) => chunk.endsWith('\n```'))).toBe(true);
		expect(codeChunks.at(-1)).toContain(`${sqlLines.at(-1)}\n\`\`\``);
		expect(reconstructChunkedText(chunks)).toBe(source);
	});

	it('balances multiple fenced blocks without changing their content', () => {
		const firstCode = Array.from({ length: 100 }, (_, index) => `    first_${index} = ${index}`).join('\n');
		const secondCode = Array.from({ length: 100 }, (_, index) => `  second_${index} = ${index}`).join('\n');
		const source = [
			'First block:',
			'```python',
			firstCode,
			'```',
			'Between blocks.',
			'```sql',
			secondCode,
			'```',
			'Done.',
		].join('\n');
		const chunks = chunkSlackText(source, 500);

		expect(chunks.every((chunk) => chunk.length <= 500)).toBe(true);
		expect(
			chunks.filter((chunk) => chunk.includes('```')).every((chunk) => tripleBacktickCount(chunk) % 2 === 0),
		).toBe(true);
		expect(reconstructChunkedText(chunks)).toBe(source);
		expect(reconstructChunkedText(chunks)).toContain('Between blocks.');
	});

	it('temporarily closes an incomplete streaming fence without changing completed text', () => {
		const incomplete = 'Before\n```sql\nSELECT **value**';
		const updated = `${incomplete}\nFROM source`;
		const completed = `${incomplete}\n\`\`\``;
		const incompleteBlocks = textContents(createTextBlocks(incomplete, { balanceIncompleteCodeFence: true }));
		const updatedBlocks = textContents(createTextBlocks(updated, { balanceIncompleteCodeFence: true }));
		const completedBlocks = textContents(createTextBlocks(completed, { balanceIncompleteCodeFence: true }));

		expect(incomplete).toBe('Before\n```sql\nSELECT **value**');
		expect(incompleteBlocks).toEqual([`${incomplete}\n\`\`\``]);
		expect(updatedBlocks).toEqual([`${updated}\n\`\`\``]);
		expect(tripleBacktickCount(incompleteBlocks[0])).toBe(2);
		expect(completedBlocks).toEqual([completed]);
		expect(tripleBacktickCount(completedBlocks[0])).toBe(2);
		expect(balanceSlackStreamingCodeFence(completed)).toBe(completed);
	});

	it('balances an incomplete final fence only for a stopped stream', () => {
		const incomplete = 'Before\n```sql\nSELECT **value**';
		const renderFinal = (stopRequested: boolean) =>
			textContents(createTextBlocks(incomplete, { balanceIncompleteCodeFence: stopRequested }));

		expect(renderFinal(false)).toEqual(['Before\n```sql\nSELECT *value*']);
		expect(renderFinal(true)).toEqual([`${incomplete}\n\`\`\``]);
		expect(incomplete).toBe('Before\n```sql\nSELECT **value**');
	});

	it('keeps long incomplete streaming code balanced within Slack limits', () => {
		const incomplete = `\`\`\`sql\n${Array.from(
			{ length: 200 },
			(_, index) => `    SELECT ${index} AS value;`,
		).join('\n')}`;
		const chunks = textContents(createTextBlocks(incomplete, { balanceIncompleteCodeFence: true }));

		expect(chunks.length).toBeGreaterThan(1);
		expect(chunks.every((chunk) => chunk.length <= SLACK_SECTION_TEXT_MAX_CHARS)).toBe(true);
		expect(chunks.every((chunk) => tripleBacktickCount(chunk) % 2 === 0)).toBe(true);
		expect(chunks.at(-1)?.endsWith('\n```')).toBe(true);
	});

	it('renders a markdown table as fenced monospace text between the prose', () => {
		const text = [
			'Here is your table:',
			'',
			'| Column A | Column B |',
			'|----------|----------|',
			'| Hello | World |',
			'| Foo | Bar |',
			'',
			'Let me know!',
		].join('\n');

		const blocks = createTextBlocks(text);

		expect(blocks.map((block) => block.type)).toEqual(['text', 'text', 'text']);
		expect(blocks[0]).toMatchObject({ content: 'Here is your table:' });
		expect(blocks[1]).toMatchObject({
			content: [
				'```',
				'Column A  Column B',
				'--------  --------',
				'Hello     World',
				'Foo       Bar',
				'```',
			].join('\n'),
		});
		expect(blocks[2]).toMatchObject({ content: 'Let me know!' });
		expect(blocks.some((block) => block.type === 'table')).toBe(false);
	});

	it('handles tables without outer pipes and alignment markers', () => {
		const text = ['Revenue | Region', ':---|---:', 'Hello | World'].join('\n');
		expect(monospaceTable(createTextBlocks(text))).toEqual({
			headers: ['Revenue', 'Region'],
			rows: [['Hello', 'World']],
		});
	});

	it('strips inline markdown and links inside table cells', () => {
		const text = ['| Name | Link |', '|------|------|', '| **Bob** | [docs](https://x.dev) |'].join('\n');
		expect(monospaceTable(createTextBlocks(text))?.rows).toEqual([['Bob', 'docs']]);
	});

	it('pads and truncates rows to match the header column count', () => {
		const text = ['| A | B | C |', '|---|---|---|', '| 1 | 2 |', '| 1 | 2 | 3 | 4 |'].join('\n');
		expect(monospaceTable(createTextBlocks(text))?.rows).toEqual([
			['1', '2', '-'],
			['1', '2', '3'],
		]);
	});

	it('shows blank cells as a placeholder so columns stay readable', () => {
		const text = ['| region | count | note |', '|---|---|---|', '| EU | 3 |', '| US |  | x |', '| | | |'].join(
			'\n',
		);
		expect(monospaceTable(createTextBlocks(text))?.rows).toEqual([
			['EU', '3', '-'],
			['US', '-', 'x'],
			['-', '-', '-'],
		]);
	});

	it('fills empty header cells', () => {
		const table = monospaceTable(createTextBlocks(['| name |  |', '|---|---|', '| a | b |'].join('\n')));
		expect(table?.headers).toEqual(['name', '-']);
	});

	it('fills the missing cell of a row that is still streaming', () => {
		const table = monospaceTable(createTextBlocks(['| id | name |', '|---|---|', '| 1'].join('\n')));
		expect(table?.rows).toEqual([['1', '-']]);
	});

	it('does not treat pipe tables inside fenced code blocks as tables', () => {
		const text = ['```', '| A | B |', '|---|---|', '| 1 | 2 |', '```'].join('\n');
		const blocks = createTextBlocks(text);
		expect(blocks.map((block) => block.type)).toEqual(['text']);
		expect(textContents(blocks)[0]).toContain('| A | B |');
	});

	it('keeps a mismatched fence marker as literal content inside a code block', () => {
		const text = ['```', '~~~', '| A | B |', '|---|---|', '| 1 | 2 |', '```'].join('\n');
		const blocks = createTextBlocks(text);
		expect(blocks.map((block) => block.type)).toEqual(['text']);
		expect(textContents(blocks)[0]).toContain('| A | B |');
	});

	it('parses a real table that follows a closed code block', () => {
		const text = ['```', 'code', '```', '', '| A | B |', '|---|---|', '| 1 | 2 |'].join('\n');
		const blocks = createTextBlocks(text);
		expect(monospaceTable(blocks.slice(1))).toEqual({ headers: ['A', 'B'], rows: [['1', '2']] });
	});

	it('clamps an oversized cell', () => {
		const long = 'x'.repeat(500);
		const text = ['| Name | Value |', '|------|-------|', `| row | ${long} |`].join('\n');
		const cell = monospaceTable(createTextBlocks(text))?.rows[0][1] ?? '';
		expect(cell.length).toBe(300);
		expect(cell.endsWith('…')).toBe(true);
	});

	it('caps table data at 99 rows and notes the rest', () => {
		const rows = Array.from({ length: 150 }, (_, i) => `| ${i} |`);
		const blocks = createTextBlocks(['| N |', '|---|', ...rows].join('\n'));
		expect(monospaceTable(blocks)?.rows).toHaveLength(99);
		expect(blocks.at(-1)).toMatchObject({
			type: 'text',
			content: '_…51 more rows, open in nao_',
			style: 'muted',
		});
	});

	it('shows a muted note by default when rows exceed the total-character budget', () => {
		const cell = 'y'.repeat(200);
		const rows = Array.from({ length: 60 }, () => `| ${cell} | ${cell} |`);
		const blocks = createTextBlocks(['| A | B |', '|---|---|', ...rows].join('\n'));
		const table = monospaceTable(blocks);
		expect(table).toBeDefined();
		expect(table!.rows.length).toBeLessThan(60);
		expect(blocks.some((block) => block.type === 'text' && String(block.content).includes('more rows'))).toBe(true);
		expect(blocks.some((block) => block.type === 'actions')).toBe(false);
	});

	it('shows a muted note by default when columns exceed Slack limits', () => {
		const headers = Array.from({ length: 25 }, (_, index) => `Column ${index + 1}`);
		const values = Array.from({ length: 25 }, (_, index) => String(index + 1));
		const blocks = createTextBlocks(
			[
				`| ${headers.join(' | ')} |`,
				`| ${headers.map(() => '---').join(' | ')} |`,
				`| ${values.join(' | ')} |`,
			].join('\n'),
		);

		expect(monospaceTable(blocks)?.headers).toHaveLength(20);
		expect(blocks.at(-1)).toMatchObject({
			type: 'text',
			content: '_…5 more columns, open in nao_',
			style: 'muted',
		});
	});

	it('splits a long table into Slack-safe sections that each repeat the header', () => {
		const rows = Array.from({ length: 99 }, (_, index) => `| row-${index} | ${'v'.repeat(80)} |`);
		const blocks = createTextBlocks(['| Name | Value |', '|---|---|', ...rows].join('\n'));
		const chunks = textContents(blocks).filter(isMonospaceTableChunk);

		expect(chunks.length).toBeGreaterThan(1);
		expect(chunks.every((chunk) => chunk.length <= SLACK_SECTION_TEXT_MAX_CHARS)).toBe(true);
		expect(chunks.every((chunk) => chunk.startsWith('```\nName'))).toBe(true);
		expect(monospaceTable(blocks)?.rows).toHaveLength(99);
	});

	it('keeps a row wider than a Slack section within the section limit', () => {
		const headers = Array.from({ length: 20 }, (_, index) => `c${index}`);
		const row = Array.from({ length: 20 }, () => 'w'.repeat(290));
		const blocks = createTextBlocks(
			[
				`| ${headers.join(' | ')} |`,
				`| ${headers.map(() => '---').join(' | ')} |`,
				`| ${row.join(' | ')} |`,
			].join('\n'),
		);
		const chunks = textContents(blocks).filter(isMonospaceTableChunk);

		expect(chunks.length).toBeGreaterThan(0);
		expect(chunks.every((chunk) => chunk.length <= SLACK_SECTION_TEXT_MAX_CHARS)).toBe(true);
	});

	it('hides truncation notices when requested', () => {
		const rows = Array.from({ length: 150 }, (_, index) => `| ${index} |`);
		const blocks = createTextBlocks(
			['| N |', '|---|', ...rows, '', '| Another |', '|---|', '| value |'].join('\n'),
			{ truncation: { kind: 'hidden' } },
		);

		expect(textContents(blocks).every(isMonospaceTableChunk)).toBe(true);
		expect(monospaceTableChunks(blocks).map((chunk) => chunk.headers)).toEqual([['N'], ['Another']]);
	});

	it('renders every table inline instead of replacing later tables with placeholders', () => {
		const blocks = createTextBlocks(
			[
				'| First |',
				'|---|',
				'| value |',
				'',
				'Between the tables.',
				'',
				'| Second |',
				'|---|',
				'| value |',
				'',
				'| Third |',
				'|---|',
				'| value |',
			].join('\n'),
			{ truncation: { kind: 'link', url: 'https://nao.example/chats/chat-123' } },
		);

		expect(monospaceTableChunks(blocks).map((chunk) => chunk.headers)).toEqual([['First'], ['Second'], ['Third']]);
		expect(blocks[1]).toMatchObject({ content: 'Between the tables.' });
		expect(countHiddenTableNotices(blocks)).toBe(0);
		expect(blocks.some((block) => block.type === 'actions')).toBe(false);
	});

	it('adds a linked action immediately after a truncated table and before trailing prose', () => {
		const url = 'https://nao.example/chats/chat-123';
		const headers = Array.from({ length: 25 }, (_, index) => `Column ${index + 1}`);
		const row = Array.from({ length: 25 }, (_, index) => String(index + 1));
		const rows = Array.from({ length: 150 }, () => `| ${row.join(' | ')} |`);
		const blocks = createTextBlocks(
			[
				'Here are the results.',
				'',
				`| ${headers.join(' | ')} |`,
				`| ${headers.map(() => '---').join(' | ')} |`,
				...rows,
				'',
				'Additional commentary after the table.',
			].join('\n'),
			{ truncation: { kind: 'link', url } },
		);
		const table = monospaceTable(blocks);
		const actionsIndex = blocks.findIndex((block) => block.type === 'actions');

		expect(blocks[0]).toMatchObject({ content: 'Here are the results.' });
		expect(blocks.at(-1)).toMatchObject({ content: 'Additional commentary after the table.' });
		expect(actionsIndex).toBe(blocks.length - 2);
		expect(blocks.filter((block) => block.type === 'actions')).toHaveLength(1);
		expect(blocks[actionsIndex]).toMatchObject({
			type: 'actions',
			children: [{ type: 'link-button', url, label: 'Open in nao to see full table' }],
		});
		expect(table?.headers).toHaveLength(20);
		expect(table?.rows).toHaveLength(99);
	});

	it('shares the table character budget across calls', () => {
		const tableState = createSlackTableRenderState();
		const cell = 'x'.repeat(80);
		const rows = Array.from({ length: 50 }, () => `| ${cell} | ${cell} |`);
		createTextBlocks(['| A | B |', '|---|---|', ...rows].join('\n'), { tableState });
		const afterFirst = tableState.remainingTableChars;
		const secondBlocks = createTextBlocks('| Second |\n|---|\n| value |', { tableState });

		expect(afterFirst).toBeLessThan(1000);
		expect(tableState.remainingTableChars).toBeLessThan(afterFirst);
		expect(tableState.tableNumber).toBe(2);
		expect(monospaceTable(secondBlocks)).toEqual({ headers: ['Second'], rows: [['value']] });
	});

	it('notes a table that no longer fits the remaining budget', () => {
		const tableState = { ...createSlackTableRenderState(), remainingTableChars: 0 };
		const blocks = createTextBlocks('| Name |\n|---|\n| value |', { tableState });

		expect(blocks).toEqual([
			expect.objectContaining({ type: 'text', content: '_…1 more row and 1 more column, open in nao_' }),
		]);
	});

	it('uses independent table state when none is provided', () => {
		expect(monospaceTable(createTextBlocks('| First |\n|---|\n| value |'))).toBeDefined();
		expect(monospaceTable(createTextBlocks('| Second |\n|---|\n| value |'))).toBeDefined();
	});
});

describe('countHiddenTableNotices', () => {
	it('returns zero because every table renders inline', () => {
		expect(countHiddenTableNotices(createTextBlocks('No omitted tables.'))).toBe(0);
		expect(
			countHiddenTableNotices(
				createTextBlocks(
					['| First |', '|---|', '| value |', '', '| Second |', '|---|', '| value |'].join('\n'),
				),
			),
		).toBe(0);
	});
});

describe('createCompletionCard', () => {
	it.each([
		[0, 'Open in nao'],
		[1, 'Open the other table in nao'],
		[3, 'Open the other 3 tables in nao'],
	])('labels the link for %i hidden tables', (hiddenTables, label) => {
		const card = createCompletionCard('https://nao.example/chats/chat-123', undefined, hiddenTables);

		expect(card.children[0]).toMatchObject({
			type: 'actions',
			children: [
				{ type: 'link-button', label },
				{ type: 'button', id: 'feedback_positive' },
				{ type: 'button', id: 'feedback_negative' },
			],
		});
		const actions = card.children[0];
		if (actions.type !== 'actions') {
			throw new Error('Expected completion card actions');
		}
		if (hiddenTables === 0) {
			expect('style' in actions.children[0] ? actions.children[0].style : undefined).toBeUndefined();
		} else {
			expect(actions.children[0]).toHaveProperty('style', 'primary');
		}
	});
});

describe('Slack payload safety', () => {
	it('builds non-empty notification text for table-only cards', () => {
		const children = createTextBlocks(['| Name | Value |', '|---|---|', '| Alpha | 123 |'].join('\n'));

		const text = buildSlackCardNotificationText(children);

		expect(text).toBe('Results table (open in nao for full data)');
	});

	it('keeps table notification text short without dumping table rows', () => {
		const rows = Array.from({ length: 100 }, (_, index) => `| secret-row-${index} | ${'x'.repeat(200)} |`);
		const children = createTextBlocks(
			['Here are the results.', '| Name | Value |', '|---|---|', ...rows].join('\n'),
		);

		const text = buildSlackCardNotificationText(children);

		expect(text).toContain('Here are the results.');
		expect(text).toContain('Results table (open in nao for full data)');
		expect(text).not.toContain('secret-row-99');
		expect(text.length).toBeLessThanOrEqual(1000);
	});

	it('builds non-empty notification text for actions-only cards', () => {
		const text = buildSlackCardNotificationText(
			createCompletionCard('https://nao.example/chats/chat-123').children,
		);

		expect(text).toBe('nao answer');
	});

	it('renders the stop button without placeholder text', () => {
		const card = createStopButtonCard();

		expect(card.children).toHaveLength(1);
		expect(card.children[0]).toMatchObject({
			type: 'actions',
			children: [{ id: 'stop_generation' }],
		});
	});

	it('splits oversized replies into safe Slack chunks', () => {
		const chunks = chunkSlackText('A long answer '.repeat(400), SLACK_SECTION_TEXT_MAX_CHARS);

		expect(chunks.length).toBeGreaterThan(1);
		expect(chunks.every((chunk) => chunk.length <= SLACK_SECTION_TEXT_MAX_CHARS)).toBe(true);
		expect(chunks.every((chunk) => chunk.length > 0)).toBe(true);
	});

	it('keeps the established prose splitting behavior', () => {
		expect(chunkSlackText('alpha beta gamma delta', 12)).toEqual(['alpha beta', 'gamma delta']);
	});

	it('reserves room for continuation fences near the chunk limit', () => {
		const source = `\`\`\`sql\n${'x'.repeat(100)}\n\`\`\``;
		const chunks = chunkSlackText(source, 30);

		expect(chunks.length).toBeGreaterThanOrEqual(4);
		expect(chunks.every((chunk) => chunk.length <= 30)).toBe(true);
		expect(chunks.every((chunk) => tripleBacktickCount(chunk) % 2 === 0)).toBe(true);
		expect(chunks.slice(1, -1).every((chunk) => chunk.startsWith('```\n') && chunk.endsWith('\n```'))).toBe(true);
		expect(reconstructChunkedText(chunks)).toBe(source);
	});

	it('preserves indentation after fenced code splits', () => {
		const codeLines = Array.from({ length: 30 }, (_, index) => `    indented_${index} = ${index}`);
		const source = ['```python', ...codeLines, '```'].join('\n');
		const chunks = chunkSlackText(source, 100);

		expect(chunks.length).toBeGreaterThan(2);
		expect(chunks.slice(1).some((chunk) => chunk.startsWith('```\n    indented_'))).toBe(true);
		expect(reconstructChunkedText(chunks)).toBe(source);
	});

	it.each([
		{ maxChars: 40, prefixLength: 18, indentationLength: 20 },
		{ maxChars: SLACK_SECTION_TEXT_MAX_CHARS, prefixLength: 1448, indentationLength: 1449 },
	])('keeps an opening fence marker intact at a $maxChars-character boundary', (example) => {
		const openingMarker = `${'\t'.repeat(example.indentationLength)}\`\`\`sql`;
		const source = ['p'.repeat(example.prefixLength), openingMarker, 'SELECT 1;', '```', 'Done.'].join('\n');
		const chunks = chunkSlackText(source, example.maxChars);

		expect(chunks.every((chunk) => chunk.length <= example.maxChars)).toBe(true);
		expect(chunks.some((chunk) => chunk.includes(openingMarker))).toBe(true);
		expect(
			chunks.filter((chunk) => chunk.includes('```')).every((chunk) => tripleBacktickCount(chunk) % 2 === 0),
		).toBe(true);
		expect(reconstructChunkedText(chunks)).toBe(source);
	});

	it('keeps an indented closing fence marker line intact when it fits the next chunk', () => {
		const closingMarker = `${'\t'.repeat(19)}\`\`\``;
		const source = ['```sql', 'x', closingMarker, 'Done.'].join('\n');
		const chunks = chunkSlackText(source, 30);

		expect(chunks.every((chunk) => chunk.length <= 30)).toBe(true);
		expect(chunks.some((chunk) => chunk.includes(closingMarker))).toBe(true);
		expect(
			chunks.filter((chunk) => chunk.includes('```')).every((chunk) => tripleBacktickCount(chunk) % 2 === 0),
		).toBe(true);
		expect(reconstructChunkedText(chunks)).toBe(source);
	});

	it('rejects a chunk size too small for a complete fence marker line', () => {
		expect(() => chunkSlackText('```sql\nx\n```', 6)).toThrow(
			'Slack text chunk size is too small for a code fence marker line.',
		);
	});

	it('keeps replies below the Slack message limit in one chunk', () => {
		const text = 'x'.repeat(SLACK_SECTION_TEXT_MAX_CHARS - 1);
		const chunks = chunkSlackText(text, SLACK_SECTION_TEXT_MAX_CHARS);

		expect(chunks).toEqual([text]);
	});

	it('recognizes recoverable Slack payload errors', () => {
		expect(isRecoverableSlackPayloadError({ data: { error: 'msg_too_long' } })).toBe(true);
		expect(isRecoverableSlackPayloadError(new Error('invalid_blocks'))).toBe(true);
		expect(isRecoverableSlackPayloadError({ data: { error: 'ratelimited' } })).toBe(false);
	});
});

describe('buildSlackTableBlocks', () => {
	it('returns null when the message contains no table', () => {
		expect(buildSlackTableBlocks('No tables here, just text.')).toBeNull();
	});

	it('builds monospace section blocks instead of a native table block', () => {
		const text = ['| Column A | Column B |', '|----------|----------|', '| Hello | World |', '| Foo | Bar |'].join(
			'\n',
		);

		const blocks = buildSlackTableBlocks(text) as AnyBlock[] | null;
		expect(blocks).not.toBeNull();
		expect(blocks!.some((block) => block.type === 'data_table' || block.type === 'table')).toBe(false);

		const sectionText = sectionTexts(blocks!).join('\n');
		expect(sectionText).toContain('Column A  Column B');
		expect(sectionText).toContain('Foo       Bar');
	});

	it('keeps every rendered section within Slack limits when a message has two tables', () => {
		const firstTable = ['| Name | Value |', '|---|---|', '| First | 1 |'];
		const secondRows = Array.from({ length: 40 }, (_, index) => `| row-${index} | ${'long value '.repeat(12)} |`);
		const text = [...firstTable, '', '| Second | Description |', '|---|---|', ...secondRows].join('\n');

		const blocks = buildSlackTableBlocks(text) as AnyBlock[] | null;
		const sections = sectionTexts(blocks ?? []);

		expect(sections.some((section) => section.includes('First'))).toBe(true);
		expect(sections.some((section) => section.includes('row-39'))).toBe(true);
		expect(sections.every((section) => section.length <= 3000)).toBe(true);
	});
});

describe('formatSlackMessageText', () => {
	it('renders tables as monospace in the plain-text fallback', () => {
		const text = formatSlackMessageText(
			['Totals:', '', '| Region | Count |', '|---|---|', '| EU | 3 |'].join('\n'),
		);

		expect(text).toContain('```\nRegion  Count\n------  -----\nEU      3\n```');
		expect(text).not.toContain('| Region |');
	});
});
