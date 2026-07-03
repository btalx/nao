import { describe, expect, it } from 'vitest';

import { modelInferenceSettingsSchema, modelSettingsMapSchema } from '../src/types/llm';

describe('modelInferenceSettingsSchema', () => {
	it('accepts an empty object (all params optional)', () => {
		expect(modelInferenceSettingsSchema.safeParse({}).success).toBe(true);
	});

	it('accepts a fully populated settings object', () => {
		const result = modelInferenceSettingsSchema.safeParse({
			temperature: 0.7,
			topP: 0.9,
			topK: 40,
			maxOutputTokens: 16_000,
			reasoningEffort: 'high',
			thinkingBudgetTokens: 8192,
		});

		expect(result.success).toBe(true);
	});

	it('bounds temperature to 0–2', () => {
		expect(modelInferenceSettingsSchema.safeParse({ temperature: 0 }).success).toBe(true);
		expect(modelInferenceSettingsSchema.safeParse({ temperature: 2 }).success).toBe(true);
		expect(modelInferenceSettingsSchema.safeParse({ temperature: -0.1 }).success).toBe(false);
		expect(modelInferenceSettingsSchema.safeParse({ temperature: 2.1 }).success).toBe(false);
	});

	it('bounds topP to 0–1', () => {
		expect(modelInferenceSettingsSchema.safeParse({ topP: 1 }).success).toBe(true);
		expect(modelInferenceSettingsSchema.safeParse({ topP: 1.01 }).success).toBe(false);
	});

	it('requires topK to be a positive integer', () => {
		expect(modelInferenceSettingsSchema.safeParse({ topK: 1 }).success).toBe(true);
		expect(modelInferenceSettingsSchema.safeParse({ topK: 0 }).success).toBe(false);
		expect(modelInferenceSettingsSchema.safeParse({ topK: 1.5 }).success).toBe(false);
	});

	it('requires maxOutputTokens to be a positive integer', () => {
		expect(modelInferenceSettingsSchema.safeParse({ maxOutputTokens: 1 }).success).toBe(true);
		expect(modelInferenceSettingsSchema.safeParse({ maxOutputTokens: 0 }).success).toBe(false);
	});

	it('requires thinkingBudgetTokens to be an integer of at least 1024', () => {
		expect(modelInferenceSettingsSchema.safeParse({ thinkingBudgetTokens: 1024 }).success).toBe(true);
		expect(modelInferenceSettingsSchema.safeParse({ thinkingBudgetTokens: 1023 }).success).toBe(false);
		expect(modelInferenceSettingsSchema.safeParse({ thinkingBudgetTokens: 2048.5 }).success).toBe(false);
	});

	it('restricts reasoningEffort to the known efforts', () => {
		for (const effort of ['off', 'low', 'medium', 'high', 'max']) {
			expect(modelInferenceSettingsSchema.safeParse({ reasoningEffort: effort }).success).toBe(true);
		}
		expect(modelInferenceSettingsSchema.safeParse({ reasoningEffort: 'ultra' }).success).toBe(false);
	});
});

describe('modelSettingsMapSchema', () => {
	it('accepts a map of model ids to settings', () => {
		const result = modelSettingsMapSchema.safeParse({
			'claude-sonnet-4-6': { reasoningEffort: 'high', maxOutputTokens: 8000 },
			'gpt-5.5': { reasoningEffort: 'medium' },
		});

		expect(result.success).toBe(true);
	});

	it('rejects entries with invalid nested settings', () => {
		const result = modelSettingsMapSchema.safeParse({
			'claude-sonnet-4-6': { thinkingBudgetTokens: 100 },
		});

		expect(result.success).toBe(false);
	});
});
