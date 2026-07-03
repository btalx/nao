import type { LlmProvider } from '@nao/shared/types';
import { describe, expect, it } from 'vitest';

import { createProviderModel } from '../src/agents/providers';
import type { ModelInferenceSettings, ProviderSettings } from '../src/types/llm';

const SETTINGS: ProviderSettings = { apiKey: 'test-key' };
const VERTEX_SETTINGS: ProviderSettings = {
	apiKey: '',
	credentials: { project: 'test-project', location: 'us-east5' },
};

function resolve(provider: LlmProvider, modelId: string, inference?: ModelInferenceSettings) {
	const settings = provider === 'vertex' ? VERTEX_SETTINGS : SETTINGS;
	const result = createProviderModel(provider, settings, modelId, inference);
	const optionKey = provider === 'vertex' && modelId.startsWith('claude-') ? 'anthropic' : provider;
	const options = (result.providerOptions[optionKey] ?? {}) as Record<string, unknown>;
	return { callSettings: result.callSettings, options, providerOptions: result.providerOptions };
}

describe('Anthropic (live-validated Claude rules)', () => {
	it('returns no call settings and no thinking overrides without inference settings', () => {
		const { callSettings, options } = resolve('anthropic', 'claude-sonnet-4-6');

		expect(callSettings).toBeUndefined();
		expect(options).not.toHaveProperty('thinking');
		expect(options).not.toHaveProperty('effort');
	});

	it('sends adaptive thinking as { thinking: adaptive, effort }', () => {
		const { options } = resolve('anthropic', 'claude-sonnet-4-6', { reasoningEffort: 'high' });

		expect(options.thinking).toEqual({ type: 'adaptive' });
		expect(options.effort).toBe('high');
	});

	it('sends budget thinking as { thinking: enabled, budgetTokens }', () => {
		const { options } = resolve('anthropic', 'claude-sonnet-4-5', { thinkingBudgetTokens: 8192 });

		expect(options.thinking).toEqual({ type: 'enabled', budgetTokens: 8192 });
		expect(options).not.toHaveProperty('effort');
	});

	it('disables thinking when reasoningEffort is off', () => {
		const { callSettings, options } = resolve('anthropic', 'claude-sonnet-4-6', {
			reasoningEffort: 'off',
			temperature: 0.5,
		});

		expect(options).not.toHaveProperty('thinking');
		expect(callSettings).toEqual({ temperature: 0.5 });
	});

	it('drops sampling params while adaptive thinking is active', () => {
		const { callSettings } = resolve('anthropic', 'claude-sonnet-4-6', {
			reasoningEffort: 'medium',
			temperature: 0.7,
			topP: 0.9,
			topK: 40,
			maxOutputTokens: 4096,
		});

		expect(callSettings).toEqual({ maxOutputTokens: 4096 });
	});

	it('drops sampling params while budget thinking is active', () => {
		const { callSettings } = resolve('anthropic', 'claude-sonnet-4-5', {
			thinkingBudgetTokens: 2048,
			temperature: 0.7,
			topP: 0.9,
		});

		expect(callSettings).toBeUndefined();
	});

	it('keeps sampling on a budget model when no budget is set', () => {
		const { callSettings, options } = resolve('anthropic', 'claude-sonnet-4-5', { temperature: 0.4 });

		expect(options).not.toHaveProperty('thinking');
		expect(callSettings).toEqual({ temperature: 0.4 });
	});

	it('drops topP when temperature is also set', () => {
		const { callSettings } = resolve('anthropic', 'claude-sonnet-4-6', { temperature: 0.7, topP: 0.9 });

		expect(callSettings).toEqual({ temperature: 0.7 });
	});

	it('keeps topP when set alone', () => {
		const { callSettings } = resolve('anthropic', 'claude-sonnet-4-6', { topP: 0.9 });

		expect(callSettings).toEqual({ topP: 0.9 });
	});

	it('only sends topK when the model declares support', () => {
		const withoutTopK = resolve('anthropic', 'claude-sonnet-4-6', { topK: 40 });
		const withTopK = resolve('anthropic', 'claude-sonnet-4-5', { topK: 40 });

		expect(withoutTopK.callSettings).toBeUndefined();
		expect(withTopK.callSettings).toEqual({ topK: 40 });
	});

	it('applies maxOutputTokens when the capability allows it', () => {
		const { callSettings } = resolve('anthropic', 'claude-sonnet-4-6', { maxOutputTokens: 16_000 });

		expect(callSettings).toEqual({ maxOutputTokens: 16_000 });
	});

	it('preserves default provider options alongside thinking overrides', () => {
		const { options } = resolve('anthropic', 'claude-sonnet-4-6', { reasoningEffort: 'low' });

		expect(options.disableParallelToolUse).toBe(false);
		expect(options).toHaveProperty('contextManagement');
	});
});

describe('OpenAI / Azure', () => {
	it('translates effort to reasoningEffort for reasoning models', () => {
		const { options } = resolve('openai', 'gpt-5.5', { reasoningEffort: 'high' });

		expect(options.reasoningEffort).toBe('high');
	});

	it('clamps a stale max effort to high on listed models that lack xhigh', () => {
		const { options } = resolve('openai', 'gpt-5.5', { reasoningEffort: 'max' });

		expect(options.reasoningEffort).toBe('high');
	});

	it('translates max to xhigh for custom models with the full effort surface', () => {
		const { options } = resolve('openai', 'gpt-6-codex-max', { reasoningEffort: 'max' });

		expect(options.reasoningEffort).toBe('xhigh');
	});

	it('skips sampling params when the model does not support sampling', () => {
		const { callSettings } = resolve('openai', 'gpt-5.5', {
			reasoningEffort: 'high',
			temperature: 1.2,
			topP: 0.8,
			maxOutputTokens: 2000,
		});

		expect(callSettings).toEqual({ maxOutputTokens: 2000 });
	});

	it('keeps temperature and topP together for non-reasoning models', () => {
		const { callSettings, options } = resolve('openai', 'gpt-4.1', {
			reasoningEffort: 'high',
			temperature: 1.5,
			topP: 0.8,
		});

		expect(options).not.toHaveProperty('reasoningEffort');
		expect(callSettings).toEqual({ temperature: 1.5, topP: 0.8 });
	});

	it('falls back to reasoning capabilities for custom Azure deployments', () => {
		const { options, callSettings } = resolve('azure', 'my-gpt-deployment', {
			reasoningEffort: 'low',
			temperature: 0.9,
		});

		expect(options.reasoningEffort).toBe('low');
		expect(callSettings).toBeUndefined();
	});
});

describe('Google Gemini', () => {
	it('translates effort to a thinking level and keeps sampling', () => {
		const { options, callSettings } = resolve('google', 'gemini-3.1-pro-preview', {
			reasoningEffort: 'max',
			temperature: 1.4,
			topK: 40,
		});

		expect(options.thinkingConfig).toEqual({ thinkingLevel: 'high' });
		expect(callSettings).toEqual({ temperature: 1.4, topK: 40 });
	});

	it('clamps a stale minimal effort to low on models that reject MINIMAL', () => {
		const { options } = resolve('google', 'gemini-3.1-pro-preview', { reasoningEffort: 'minimal' });

		expect(options.thinkingConfig).toEqual({ thinkingLevel: 'low' });
	});

	it('keeps minimal on models that support it', () => {
		const { options } = resolve('google', 'gemini-3-flash-preview', { reasoningEffort: 'minimal' });

		expect(options.thinkingConfig).toEqual({ thinkingLevel: 'minimal' });
	});

	it('clamps custom models to the low/high levels every Gemini accepts', () => {
		const minimal = resolve('google', 'gemini-9-experimental', { reasoningEffort: 'minimal' });
		const medium = resolve('google', 'gemini-9-experimental', { reasoningEffort: 'medium' });

		expect(minimal.options.thinkingConfig).toEqual({ thinkingLevel: 'low' });
		expect(medium.options.thinkingConfig).toEqual({ thinkingLevel: 'low' });
	});

	it('sends nothing when effort is off', () => {
		const { options } = resolve('google', 'gemini-3.1-pro-preview', { reasoningEffort: 'off' });

		expect(options).not.toHaveProperty('thinkingConfig');
	});

	it('translates a token budget to thinkingConfig.thinkingBudget', () => {
		const { options } = resolve('google', 'gemini-2.5-pro', { thinkingBudgetTokens: 2048 });

		expect(options.thinkingConfig).toEqual({ thinkingBudget: 2048 });
	});

	it('never sends a thinking level to budget-based Gemini 2.5 models', () => {
		const { options } = resolve('google', 'gemini-2.5-flash', { reasoningEffort: 'minimal' });

		expect(options).not.toHaveProperty('thinkingConfig');
	});
});

describe('Bedrock', () => {
	it('sends adaptive reasoningConfig for Claude and drops sampling', () => {
		const { options, callSettings } = resolve('bedrock', 'us.anthropic.claude-sonnet-4-6', {
			reasoningEffort: 'max',
			temperature: 0.5,
		});

		expect(options.reasoningConfig).toEqual({ type: 'adaptive', maxReasoningEffort: 'max' });
		expect(callSettings).toBeUndefined();
	});

	it('sends budget reasoningConfig for custom Claude model ids', () => {
		const { options } = resolve('bedrock', 'anthropic.claude-3-7-sonnet', { thinkingBudgetTokens: 4096 });

		expect(options.reasoningConfig).toEqual({ type: 'enabled', budgetTokens: 4096 });
	});

	it('keeps sampling and skips reasoning for non-Claude models', () => {
		const { options, callSettings } = resolve('bedrock', 'deepseek.v3.2', {
			reasoningEffort: 'high',
			temperature: 0.9,
		});

		expect(options).not.toHaveProperty('reasoningConfig');
		expect(callSettings).toEqual({ temperature: 0.9 });
	});
});

describe('OpenRouter', () => {
	it('translates effort to the reasoning option', () => {
		const { options } = resolve('openrouter', 'moonshotai/kimi-k2.5', { reasoningEffort: 'medium' });

		expect(options.reasoning).toEqual({ enabled: true, effort: 'medium' });
	});
});

describe('Vertex', () => {
	it('applies the Claude rules and keys options under anthropic', () => {
		const { options, providerOptions, callSettings } = resolve('vertex', 'claude-sonnet-4-6', {
			reasoningEffort: 'high',
			topP: 0.9,
		});

		expect(providerOptions).not.toHaveProperty('vertex');
		expect(options.thinking).toEqual({ type: 'adaptive' });
		expect(options.effort).toBe('high');
		expect(callSettings).toBeUndefined();
	});

	it('applies the Gemini rules and keys options under vertex', () => {
		const { options, providerOptions } = resolve('vertex', 'gemini-3-flash-preview', { reasoningEffort: 'low' });

		expect(providerOptions).not.toHaveProperty('anthropic');
		expect(options.thinkingConfig).toEqual({ thinkingLevel: 'low' });
	});
});

describe('Mistral and Ollama', () => {
	it('passes sampling and maxOutputTokens through for Mistral', () => {
		const { callSettings } = resolve('mistral', 'mistral-medium-latest', {
			temperature: 0.3,
			maxOutputTokens: 1000,
		});

		expect(callSettings).toEqual({ temperature: 0.3, maxOutputTokens: 1000 });
	});

	it('passes sampling including topK through for Ollama', () => {
		const { callSettings } = resolve('ollama', 'qwen3:8b', { temperature: 0.5, topK: 20 });

		expect(callSettings).toEqual({ temperature: 0.5, topK: 20 });
	});
});
