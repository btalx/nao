import { describe, expect, it } from 'vitest';

import { buildSlackTableBlocks, createTextBlocks } from '../src/utils/messaging-provider';

type AnyBlock = { type: string; [key: string]: unknown };
type TextChild = { type: string; content: string };

const contents = (blocks: ReturnType<typeof createTextBlocks>): string[] =>
	blocks.map((block) => (block as TextChild).content);

const tableChunks = (blocks: ReturnType<typeof createTextBlocks>): string[] =>
	contents(blocks).filter((content) => content.startsWith('```'));

describe('createTextBlocks', () => {
	it('returns a single text block when there is no table', () => {
		const blocks = createTextBlocks('Just a plain answer with **bold**.');
		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toMatchObject({ type: 'text', content: 'Just a plain answer with *bold*.' });
	});

	it('renders a markdown table as a monospace text block, never a Slack table block', () => {
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

		expect(blocks.every((block) => block.type === 'text')).toBe(true);
		expect(blocks.some((block) => (block as AnyBlock).type === 'table')).toBe(false);

		const table = tableChunks(blocks)[0];
		expect(table).toBeDefined();
		expect(table).toContain('Column A  Column B');
		expect(table).toContain('Hello     World');
		expect(table).toContain('Foo       Bar');
		expect(contents(blocks)[0]).toBe('Here is your table:');
		expect(contents(blocks).at(-1)).toBe('Let me know!');
	});

	it('renders empty and missing cells as blank padding rather than invalid blocks', () => {
		// ENG-6842: an empty cell produced an empty `raw_text` element that Slack rejected.
		const text = ['| A | B | C |', '|---|---|---|', '| 1 |  | 3 |', '| 4 | 5 |'].join('\n');
		const blocks = createTextBlocks(text);
		expect(blocks.every((block) => block.type === 'text')).toBe(true);
		const table = tableChunks(blocks)[0];
		expect(table).toContain('1');
		expect(table).toContain('4  5');
	});

	it('truncates an oversized cell so a chunk can never exceed the Slack section limit', () => {
		// ENG-6842: a very long cell tripped Slack's "failed to match any allowed schemas".
		const huge = 'x'.repeat(5000);
		const text = ['| A | B |', '|---|---|', `| ${huge} | ok |`].join('\n');
		const table = tableChunks(createTextBlocks(text))[0];
		expect(table.length).toBeLessThan(3000);
		expect(table).toContain('…');
	});

	it('splits a wide table into multiple monospace blocks each under the section limit', () => {
		const rows = Array.from({ length: 60 }, (_, i) => `| row-${i} | ${'v'.repeat(80)} |`);
		const text = ['| A | B |', '|---|---|', ...rows].join('\n');
		const chunks = tableChunks(createTextBlocks(text));
		expect(chunks.length).toBeGreaterThan(1);
		for (const chunk of chunks) {
			expect(chunk.length).toBeLessThanOrEqual(2900);
		}
	});

	it('caps very long tables and points overflow at nao', () => {
		const rows = Array.from({ length: 250 }, (_, i) => `| ${i} | v${i} |`);
		const text = ['| A | B |', '|---|---|', ...rows].join('\n');
		const overflow = contents(createTextBlocks(text)).find((c) => c.includes('more row'));
		expect(overflow).toBeDefined();
		expect(overflow).toContain('open in nao');
	});

	it('does not treat pipe tables inside fenced code blocks as tables', () => {
		const text = ['```', '| A | B |', '|---|---|', '| 1 | 2 |', '```'].join('\n');
		const blocks = createTextBlocks(text);
		expect(blocks.map((block) => block.type)).toEqual(['text']);
	});
});

describe('buildSlackTableBlocks', () => {
	it('returns null when the message contains no table', () => {
		expect(buildSlackTableBlocks('No tables here, just text.')).toBeNull();
	});

	it('builds only valid section blocks (no fragile Slack table block) from a markdown table', () => {
		const text = ['| Column A | Column B |', '|----------|----------|', '| Hello | World |', '| Foo | Bar |'].join(
			'\n',
		);

		const blocks = buildSlackTableBlocks(text) as AnyBlock[] | null;
		expect(blocks).not.toBeNull();
		expect(blocks!.length).toBeGreaterThan(0);
		expect(blocks!.some((block) => block.type === 'table')).toBe(false);
	});
});
