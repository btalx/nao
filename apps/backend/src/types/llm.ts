import type { AmazonBedrockLanguageModelOptions } from '@ai-sdk/amazon-bedrock';
import type { AnthropicProviderOptions } from '@ai-sdk/anthropic';
import type { OpenAIResponsesProviderOptions as AzureOpenAIResponsesProviderOptions } from '@ai-sdk/azure';
import type { GoogleGenerativeAIProviderOptions } from '@ai-sdk/google';
import type { MistralLanguageModelOptions } from '@ai-sdk/mistral';
import type { OpenAIResponsesProviderOptions } from '@ai-sdk/openai';
import { LLM_PROVIDERS, type LlmProvider } from '@nao/shared/types';
import type { LanguageModelV3, OpenRouterProviderOptions } from '@openrouter/ai-sdk-provider';
import type { OllamaChatProviderOptions } from 'ai-sdk-ollama';
import { z } from 'zod/v4';

import { TokenCost } from './chat';

export const llmProviderSchema = z.enum(LLM_PROVIDERS);

export const llmSelectedModelSchema = z.object({
	provider: llmProviderSchema,
	modelId: z.string(),
});

export type ProviderSettings = { apiKey: string; baseURL?: string; credentials?: Record<string, string> };

export const customModelCostSchema = z.object({
	inputNoCache: z.number().min(0).optional(),
	inputCacheRead: z.number().min(0).optional(),
	inputCacheWrite: z.number().min(0).optional(),
	output: z.number().min(0).optional(),
});

export const customModelMetadataSchema = z.object({
	id: z.string().min(1),
	displayName: z.string().optional(),
	costPerM: customModelCostSchema.optional(),
});

export type ModelCosts = z.infer<typeof customModelCostSchema>;
export type CustomModelMetadata = z.infer<typeof customModelMetadataSchema>;

export const reasoningEffortSchema = z.enum(['off', 'minimal', 'low', 'medium', 'high', 'max']);
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;

export const serviceTierSchema = z.enum(['auto', 'default', 'standard', 'flex', 'priority', 'reserved']);
export type ServiceTier = z.infer<typeof serviceTierSchema>;

export const safetyThresholdSchema = z.enum([
	'HARM_BLOCK_THRESHOLD_UNSPECIFIED',
	'BLOCK_LOW_AND_ABOVE',
	'BLOCK_MEDIUM_AND_ABOVE',
	'BLOCK_ONLY_HIGH',
	'BLOCK_NONE',
	'OFF',
]);

export const mediaResolutionSchema = z.enum([
	'MEDIA_RESOLUTION_UNSPECIFIED',
	'MEDIA_RESOLUTION_LOW',
	'MEDIA_RESOLUTION_MEDIUM',
	'MEDIA_RESOLUTION_HIGH',
]);

/**
 * Superset of every per-model inference parameter an admin can tune, keyed by model id in
 * `modelSettings`. A given model only exposes/uses the subset described by its capabilities
 * (see `getModelParameterSpec`); the rest are ignored for that model.
 */
export const modelInferenceSettingsSchema = z.object({
	temperature: z.number().min(0).max(2).optional(),
	topP: z.number().min(0).max(1).optional(),
	topK: z.number().int().min(1).optional(),
	maxOutputTokens: z.number().int().min(1).optional(),
	/** Adaptive-thinking effort level (modern Claude, OpenAI reasoning, ...). */
	reasoningEffort: reasoningEffortSchema.optional(),
	/** Legacy budget-based thinking token budget (older Claude models). */
	thinkingBudgetTokens: z.number().int().min(1024).optional(),
	/** OpenAI/Azure: response length/verbosity hint. */
	textVerbosity: z.enum(['low', 'medium', 'high']).optional(),
	/** OpenAI/Azure: reasoning summary detail level. */
	reasoningSummary: z.enum(['auto', 'detailed']).optional(),
	/** OpenAI/Azure/Mistral: allow parallel tool calls (Anthropic: inverse of disableParallelToolUse). */
	parallelToolCalls: z.boolean().optional(),
	/** OpenAI/Azure: cap on built-in tool calls per response. */
	maxToolCalls: z.number().int().min(1).optional(),
	/** OpenAI/Azure, Google/Vertex, Bedrock: processing tier (allowed values vary per provider). */
	serviceTier: serviceTierSchema.optional(),
	/** Anthropic: output speed mode (fast mode trades cost for latency). */
	speed: z.enum(['standard', 'fast']).optional(),
	/** Anthropic: inference geography / data residency. */
	inferenceGeo: z.enum(['us', 'global']).optional(),
	/** Anthropic: send previous reasoning blocks back to the model. */
	sendReasoning: z.boolean().optional(),
	/** Google/Vertex Gemini: include thought summaries in the response. */
	includeThoughts: z.boolean().optional(),
	/** Google/Vertex Gemini: harm-block threshold applied to all safety categories. */
	safetyThreshold: safetyThresholdSchema.optional(),
	/** Google/Vertex Gemini: resolution used for media inputs. */
	mediaResolution: mediaResolutionSchema.optional(),
	/** Mistral: inject the safety guardrail prompt. */
	safePrompt: z.boolean().optional(),
	/** Mistral: max images processed per document. */
	documentImageLimit: z.number().int().min(1).optional(),
	/** Mistral: max pages processed per document. */
	documentPageLimit: z.number().int().min(1).optional(),
});
export type ModelInferenceSettings = z.infer<typeof modelInferenceSettingsSchema>;

export const modelSettingsMapSchema = z.record(z.string(), modelInferenceSettingsSchema);
export type ModelSettingsMap = z.infer<typeof modelSettingsMapSchema>;

/** How a model exposes "thinking"/reasoning control, if at all. */
export type ModelThinkingMode = 'adaptive' | 'budget' | 'none';

/** Keys of `ModelInferenceSettings` that can be surfaced as an editable control. */
export type ParamKey = keyof ModelInferenceSettings;

/** Keys rendered as a numeric input. */
export type NumberParamKey = {
	[K in ParamKey]: NonNullable<ModelInferenceSettings[K]> extends number ? K : never;
}[ParamKey];

/** Keys rendered as an on/off/default control. */
export type BooleanParamKey = {
	[K in ParamKey]: NonNullable<ModelInferenceSettings[K]> extends boolean ? K : never;
}[ParamKey];

/** Keys rendered as an enum dropdown. */
export type SelectParamKey = Exclude<
	{
		[K in ParamKey]: NonNullable<ModelInferenceSettings[K]> extends string ? K : never;
	}[ParamKey],
	'reasoningEffort'
>;

/** Provider-specific per-call options a model can additionally expose (beyond the core set). */
export type ExtraParamKey = Exclude<
	ParamKey,
	'temperature' | 'topP' | 'topK' | 'maxOutputTokens' | 'reasoningEffort' | 'thinkingBudgetTokens'
>;

/** Declares which tunable inference parameters a model supports, driving both UI and translation. */
export type ModelCapabilities = {
	thinking: ModelThinkingMode;
	/** Supports temperature / topP sampling params. */
	sampling: boolean;
	/** Supports the topK sampling param (deprecated on newer Claude models). */
	topK: boolean;
	/** Supports an explicit max output token limit. */
	maxOutputTokens: boolean;
	/** Restrict the exposed reasoning-effort options (e.g. Mistral only supports off/high). */
	effortOptions?: ReasoningEffort[];
	/** Highest temperature the provider accepts (defaults to 2); drives the UI bound and a request-time clamp. */
	temperatureMax?: number;
	/** Additional provider-specific per-call options this model supports. */
	extraParams?: ExtraParamKey[];
	/** Allowed service tiers, when `extraParams` includes `serviceTier` (values vary per provider). */
	serviceTierOptions?: ServiceTier[];
	/**
	 * Provider-enforced physical max output tokens per request. For budget-thinking Claude the
	 * SDK sends `max_tokens = maxOutputTokens + budgetTokens` capped at this limit, and the API
	 * rejects the request when the budget is not strictly below the final max_tokens — so stored
	 * budgets are clamped under this cap at request-build time.
	 */
	maxOutputCap?: number;
	/** Budget-thinking Gemini: the thinkingBudget range the API accepts (out-of-range values are rejected). */
	thinkingBudgetRange?: { min: number; max: number };
};

/** A single editable inference-parameter control, derived from a model's capabilities. */
export type ParamControl =
	| { key: 'reasoningEffort'; kind: 'effort'; label: string; options: ReasoningEffort[] }
	| {
			key: NumberParamKey;
			kind: 'number';
			label: string;
			placeholder: string;
			step: number;
			min?: number;
			max?: number;
			/** Sampling controls are disabled while thinking is active. */
			group?: 'sampling';
			/** Disabled when the referenced param has a value (mutually exclusive settings). */
			exclusiveWith?: NumberParamKey;
			/** When both are set, this value must stay strictly below the referenced param's value. */
			lessThan?: NumberParamKey;
	  }
	| { key: SelectParamKey; kind: 'select'; label: string; options: readonly string[] }
	| { key: BooleanParamKey; kind: 'boolean'; label: string };

export const llmConfigSchema = z.object({
	id: z.string(),
	provider: llmProviderSchema,
	apiKeyPreview: z.string().nullable(),
	credentialPreviews: z.record(z.string(), z.string()).nullable(),
	enabledModels: z.array(z.string()).nullable(),
	customModels: z.array(customModelMetadataSchema),
	modelSettings: modelSettingsMapSchema,
	baseUrl: z.string().url().nullable(),
	createdAt: z.date(),
	updatedAt: z.date(),
});

/** Flatten an interface into a plain type so it gains an implicit index signature. */
type Flatten<T> = { [K in keyof T]: T[K] };

/** Map each provider to its specific config type */
export type ProviderConfigMap = {
	google: GoogleGenerativeAIProviderOptions;
	openai: OpenAIResponsesProviderOptions;
	anthropic: AnthropicProviderOptions;
	mistral: MistralLanguageModelOptions;
	openrouter: OpenRouterProviderOptions;
	ollama: Flatten<OllamaChatProviderOptions>;
	bedrock: AmazonBedrockLanguageModelOptions;
	vertex: GoogleGenerativeAIProviderOptions;
	azure: AzureOpenAIResponsesProviderOptions;
};

/** Model definition with provider-specific config type */
type ProviderModel<P extends LlmProvider> = {
	id: string;
	name: string;
	default?: boolean;
	contextWindow?: number;
	config?: ProviderConfigMap[P];
	costPerM?: TokenCost;
	/** Tunable inference parameters this model supports. Omit to expose no tunable parameters. */
	capabilities?: ModelCapabilities;
};

/** An additional credential field (e.g. AWS Access Key ID) */
export type AuthField = {
	name: string;
	label: string;
	envVar: string;
	secret?: boolean;
	multiline?: boolean;
	placeholder?: string;
};

/** Describes how a provider authenticates */
export type ProviderAuth = {
	apiKey: 'required' | 'optional' | 'none';
	/**
	 * Alternative ways to authenticate via the environment. Each inner array is a
	 * bundle: every var in a bundle must be set, and any single satisfied bundle is
	 * enough to consider the provider env-configured. Use multi-var bundles for
	 * paired credentials (e.g. access key + secret) and single-var bundles for
	 * ambient signals where the SDK resolves the secret itself (AWS task role,
	 * IRSA, named profile, …).
	 */
	alternativeEnvVars?: string[][];
	hint?: string;
	extraFields?: AuthField[];
};

/** Data-only provider config (no SDK imports, safe for frontend) */
export type ProviderMeta<P extends LlmProvider> = {
	auth: ProviderAuth;
	envVar: string;
	baseUrlEnvVar?: string;
	models: readonly ProviderModel<P>[];
	extractorModelId: string;
	summaryModelId: string;
};

export type ProviderMetaMap = {
	[P in LlmProvider]: ProviderMeta<P>;
};

/** Full provider configuration with SDK create function (backend-only) */
type ProviderConfig<P extends LlmProvider> = ProviderMeta<P> & {
	create: (settings: ProviderSettings, modelId: string) => LanguageModelV3;
	defaultOptions?: ProviderConfigMap[P];
};

/** Full providers type - each key gets its own config type */
export type LlmProvidersType = {
	[P in LlmProvider]: ProviderConfig<P>;
};

export const LLM_INFERENCE_TYPES = ['memory_extraction', 'compaction', 'title_generation'] as const;
export type LlmInferenceType = (typeof LLM_INFERENCE_TYPES)[number];
