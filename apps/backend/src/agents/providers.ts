import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { type AnthropicProviderOptions, createAnthropic } from '@ai-sdk/anthropic';
import { createAzure } from '@ai-sdk/azure';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createVertex } from '@ai-sdk/google-vertex';
import { createVertexAnthropic } from '@ai-sdk/google-vertex/anthropic';
import { createMistral } from '@ai-sdk/mistral';
import { createOpenAI } from '@ai-sdk/openai';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import type { LlmProvider } from '@nao/shared/types';
import { createOpenRouter, LanguageModelV3 } from '@openrouter/ai-sdk-provider';
import { createOllama } from 'ai-sdk-ollama';

import type {
	LlmProvidersType,
	ModelCapabilities,
	ModelInferenceSettings,
	ProviderConfigMap,
	ProviderSettings,
	ReasoningEffort,
} from '../types/llm';
import { DEFAULT_TEMPERATURE_MAX, getModelCapabilities, isAnthropicApiModel, PROVIDER_META } from './provider-meta';

export {
	getDefaultModelId,
	getProviderApiKeyRequirement,
	getProviderAuth,
	KNOWN_MODELS,
	PROVIDER_META,
} from './provider-meta';

// See: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
export const CACHE_1H = { type: 'ephemeral', ttl: '1h' } as const;
export const CACHE_5M = { type: 'ephemeral' } as const;

/** Provider configuration with env var names and known models */
export const LLM_PROVIDERS: LlmProvidersType = {
	anthropic: {
		...PROVIDER_META.anthropic,
		create: (settings, modelId) => createAnthropic(settings).chat(modelId),
		defaultOptions: {
			disableParallelToolUse: false,
			contextManagement: {
				edits: [
					{
						type: 'clear_tool_uses_20250919',
						trigger: {
							type: 'input_tokens',
							value: 180_000,
						},
						clearToolInputs: false,
						excludeTools: [
							'display_chart',
							'execute_python',
							'execute_sql',
							'execute_sandboxed_code',
							'grep',
							'list',
							'read',
							'search',
							'story',
						],
					},
				],
			},
		} satisfies AnthropicProviderOptions,
	},
	openai: {
		...PROVIDER_META.openai,
		create: (settings, modelId) => createOpenAI(settings).responses(modelId),
		defaultOptions: { store: false, truncation: 'auto', reasoningSummary: 'auto' },
	},
	google: {
		...PROVIDER_META.google,
		create: (settings, modelId) => createGoogleGenerativeAI(settings).chat(modelId),
	},
	mistral: {
		...PROVIDER_META.mistral,
		create: (settings, modelId) => createMistral(settings).chat(modelId),
	},
	openrouter: {
		...PROVIDER_META.openrouter,
		create: (settings, modelId) => createOpenRouter(settings).chat(modelId),
	},
	ollama: {
		...PROVIDER_META.ollama,
		create: (settings, modelId) => createOllama(settings).chat(modelId),
	},
	bedrock: {
		...PROVIDER_META.bedrock,
		create: (settings, modelId) => {
			const creds = settings.credentials;
			const region = creds?.region || process.env.AWS_REGION || 'us-east-1';
			const resolvedModelId = resolveBedrockModelId(modelId, region);
			let config;

			if (settings.apiKey) {
				config = { apiKey: settings.apiKey, region };
			} else if (creds?.accessKeyId && creds?.secretAccessKey) {
				config = {
					region,
					accessKeyId: creds.accessKeyId,
					secretAccessKey: creds.secretAccessKey,
					...(creds.sessionToken && { sessionToken: creds.sessionToken }),
				};
			} else if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
				config = {
					region,
					accessKeyId: process.env.AWS_ACCESS_KEY_ID,
					secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
					...(process.env.AWS_SESSION_TOKEN && { sessionToken: process.env.AWS_SESSION_TOKEN }),
				};
			} else {
				config = {
					region,
					credentialProvider: fromNodeProviderChain({
						profile: process.env.AWS_PROFILE,
						ignoreCache: true,
					}),
				};
			}

			return createAmazonBedrock(config).languageModel(resolvedModelId);
		},
	},
	vertex: {
		...PROVIDER_META.vertex,
		create: (settings, modelId) => {
			const creds = settings.credentials;
			const project = creds?.project || process.env.GOOGLE_VERTEX_PROJECT;
			const location = creds?.location || process.env.GOOGLE_VERTEX_LOCATION || 'global';

			const googleAuthOptions = buildVertexAuthOptions(creds);
			const config = { project, location, baseURL: settings.baseURL, googleAuthOptions };

			if (modelId.startsWith('claude-')) {
				return createVertexAnthropic(config)(modelId);
			}
			return createVertex(config)(modelId);
		},
	},
	azure: {
		...PROVIDER_META.azure,
		create: (settings, modelId) => {
			const creds = settings.credentials;
			const resourceName = creds?.resourceName || process.env.AZURE_RESOURCE_NAME;
			const apiVersion = creds?.apiVersion || process.env.AZURE_API_VERSION;
			const useDeploymentBasedUrls =
				(creds?.useDeploymentBasedUrls || process.env.AZURE_USE_DEPLOYMENT_BASED_URLS) === 'true';

			return createAzure({
				apiKey: settings.apiKey,
				...(settings.baseURL ? { baseURL: settings.baseURL } : resourceName ? { resourceName } : {}),
				...(apiVersion && { apiVersion }),
				...(useDeploymentBasedUrls && { useDeploymentBasedUrls }),
			})(modelId);
		},
		defaultOptions: { store: false, reasoningSummary: 'auto' },
	},
};

/** Standard AI SDK call settings resolved from admin-tuned per-model parameters. */
export type ModelCallSettings = {
	temperature?: number;
	topP?: number;
	topK?: number;
	maxOutputTokens?: number;
};

export type ProviderModelResult = {
	model: LanguageModelV3;
	providerOptions: Partial<{ [P in LlmProvider]: ProviderConfigMap[P] }>;
	contextWindow: number;
	/** Call settings resolved from admin per-model inference parameters, applied at the call site. */
	callSettings?: ModelCallSettings;
};

/** Create a language model instance with merged provider options */
export function createProviderModel(
	provider: LlmProvider,
	settings: ProviderSettings,
	modelId: string,
	inferenceSettings?: ModelInferenceSettings,
): ProviderModelResult {
	const providerConfig = LLM_PROVIDERS[provider];
	const defaultOptions = providerConfig.defaultOptions ?? {};
	const modelConfig = getProviderModelConfig(provider, modelId);
	const contextWindow = providerConfig.models.find((m) => m.id === modelId)?.contextWindow ?? 200_000;

	const { callSettings, providerOverrides } = resolveInferenceOptions(provider, modelId, inferenceSettings);

	// Claude-on-Vertex reads provider options under the `anthropic` key (Gemini-on-Vertex reads
	// `vertex`); everything else keys options under its own provider id.
	const optionKey: LlmProvider = provider === 'vertex' && modelId.startsWith('claude-') ? 'anthropic' : provider;

	return {
		model: providerConfig.create(settings, modelId),
		providerOptions: {
			[optionKey]: { ...defaultOptions, ...modelConfig, ...providerOverrides },
		},
		contextWindow,
		callSettings,
	};
}

/**
 * Translate normalized per-model inference settings into AI SDK call settings and
 * provider-specific option overrides, based on the model's declared capabilities.
 * Sampling params (temperature/topP/topK) are dropped for Claude when thinking is active
 * So we hide these options for models that don't support sampling.
 */
function resolveInferenceOptions(
	provider: LlmProvider,
	modelId: string,
	settings?: ModelInferenceSettings,
): { callSettings?: ModelCallSettings; providerOverrides?: Record<string, unknown> } {
	if (!settings) {
		return {};
	}

	const capabilities = getModelCapabilities(provider, modelId);
	const thinking = resolveThinking(provider, modelId, capabilities, settings);
	const extraOverrides = resolveExtraOptions(provider, modelId, capabilities, settings);
	const providerOverrides = mergeProviderOverrides(thinking.providerOverrides, extraOverrides);
	const thinkingActive = thinking.thinkingActive;

	const callSettings: ModelCallSettings = {};
	if (settings.maxOutputTokens !== undefined && capabilities?.maxOutputTokens !== false) {
		callSettings.maxOutputTokens = settings.maxOutputTokens;
	}

	const claudeApi = isAnthropicApiModel(provider, modelId);
	// Claude's Messages API rejects sampling params while thinking is active.
	const dropSampling = claudeApi && thinkingActive;
	if (capabilities?.sampling !== false && !dropSampling) {
		// Clamp to the provider bound so a stale stored value (e.g. 1.5 saved for a Claude
		// model that caps temperature at 1) degrades gracefully instead of failing the request.
		if (settings.temperature !== undefined) {
			const temperatureMax = capabilities?.temperatureMax ?? DEFAULT_TEMPERATURE_MAX;
			callSettings.temperature = clampNumber(settings.temperature, 0, temperatureMax);
		}
		if (settings.topP !== undefined) {
			callSettings.topP = clampNumber(settings.topP, 0, 1);
		}
		// topK is deprecated on newer models (e.g. Claude Opus 4.8); only send it when the
		// model declares support, so a stale stored value can't trigger an API error.
		if (settings.topK !== undefined && capabilities?.topK !== false) {
			callSettings.topK = settings.topK;
		}
	}

	// Claude silently ignores topP when temperature is set; drop it here so the sent params
	// (and their Langfuse trace) reflect what the model actually receives.
	if (claudeApi && callSettings.temperature !== undefined && callSettings.topP !== undefined) {
		delete callSettings.topP;
	}

	return {
		callSettings: Object.keys(callSettings).length > 0 ? callSettings : undefined,
		providerOverrides,
	};
}

function clampNumber(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

/** Anthropic's minimum extended-thinking budget; below this the API rejects the request. */
const MIN_THINKING_BUDGET = 1024;
/**
 * Output tokens reserved for the visible answer when fitting a thinking budget under a limit.
 * One SDK-minimum-budget worth (1024) keeps `budget_tokens` strictly below the final
 * `max_tokens` after the SDK clamps the summed value to the model's physical cap, while
 * interfering as little as possible with the admin's stored budget.
 */
const THINKING_OUTPUT_RESERVE = 1024;

function fitBudget(budget: number, limit: number | undefined): number | undefined {
	if (limit === undefined) {
		return budget;
	}
	const fitted = Math.min(budget, limit - THINKING_OUTPUT_RESERVE);
	return fitted >= MIN_THINKING_BUDGET ? fitted : undefined;
}

/**
 * Refit a resolved Claude thinking budget against the effective max output tokens of a specific
 * call. The Anthropic and Bedrock SDKs send `max_tokens = maxOutputTokens + budgetTokens`, so
 * call sites that override maxOutputTokens after model resolution (chat loop, memory extraction,
 * compaction) apply this to keep the summed request within provider limits: the budget is
 * clamped to leave `THINKING_OUTPUT_RESERVE` visible-output tokens under the call's max, and
 * thinking is dropped entirely when the clamped budget would fall below Anthropic's minimum.
 */
export function fitThinkingBudget(
	providerOptions: ProviderModelResult['providerOptions'],
	maxOutputTokens: number,
): ProviderModelResult['providerOptions'] {
	const fitted = { ...providerOptions };

	const anthropic = fitted.anthropic;
	const thinking = anthropic?.thinking;
	if (anthropic && thinking?.type === 'enabled' && thinking.budgetTokens !== undefined) {
		const budget = fitBudget(thinking.budgetTokens, maxOutputTokens);
		const rest = { ...anthropic };
		delete rest.thinking;
		fitted.anthropic =
			budget === undefined ? rest : { ...rest, thinking: { type: 'enabled', budgetTokens: budget } };
	}

	const bedrock = fitted.bedrock;
	const reasoning = bedrock?.reasoningConfig;
	if (bedrock && reasoning?.type === 'enabled' && reasoning.budgetTokens !== undefined) {
		const budget = fitBudget(reasoning.budgetTokens, maxOutputTokens);
		const rest = { ...bedrock };
		delete rest.reasoningConfig;
		fitted.bedrock =
			budget === undefined ? rest : { ...rest, reasoningConfig: { type: 'enabled', budgetTokens: budget } };
	}

	return fitted;
}

type ThinkingResult = { providerOverrides?: Record<string, unknown>; thinkingActive: boolean };

const THINKING_INACTIVE: ThinkingResult = { thinkingActive: false };

/** An effort that actually activates thinking; `off` always means "send nothing" and never translates. */
type ActiveEffort = Exclude<ReasoningEffort, 'off'>;

/** nao effort → OpenAI/Azure & OpenRouter reasoning-effort vocabulary. */
const EFFORT_TO_OPENAI: Record<ActiveEffort, string> = {
	minimal: 'minimal',
	low: 'low',
	medium: 'medium',
	high: 'high',
	max: 'xhigh',
};

/** nao effort → Anthropic adaptive effort (no `minimal` in Anthropic's vocabulary). */
const EFFORT_TO_ANTHROPIC: Record<ActiveEffort, string> = {
	minimal: 'low',
	low: 'low',
	medium: 'medium',
	high: 'high',
	max: 'max',
};

/** nao effort → Gemini 3 thinking level. */
const EFFORT_TO_GEMINI_LEVEL: Record<ActiveEffort, string> = {
	minimal: 'minimal',
	low: 'low',
	medium: 'medium',
	high: 'high',
	max: 'high',
};

/** nao effort → Bedrock adaptive max reasoning effort. */
const EFFORT_TO_BEDROCK: Record<ActiveEffort, string> = {
	minimal: 'low',
	low: 'low',
	medium: 'medium',
	high: 'high',
	max: 'max',
};

const EFFORT_ORDER: ReasoningEffort[] = ['off', 'minimal', 'low', 'medium', 'high', 'max'];

/**
 * Snap a stored effort to the nearest option the model declares, so a stale setting (e.g.
 * `minimal` saved for a Gemini Pro model that rejects it) can never produce an API error.
 */
function clampEffort(effort: ActiveEffort, options: ReasoningEffort[] | undefined): ActiveEffort {
	if (!options || options.includes(effort)) {
		return effort;
	}
	const candidates = options.filter((option): option is ActiveEffort => option !== 'off');
	if (candidates.length === 0) {
		return effort;
	}
	const target = EFFORT_ORDER.indexOf(effort);
	return candidates.reduce((best, candidate) => {
		const bestDistance = Math.abs(EFFORT_ORDER.indexOf(best) - target);
		const candidateDistance = Math.abs(EFFORT_ORDER.indexOf(candidate) - target);
		return candidateDistance < bestDistance ? candidate : best;
	});
}

/**
 * Map the normalized thinking settings onto the provider-specific thinking API the given model
 * supports. Each provider exposes reasoning differently (Anthropic `thinking`, OpenAI
 * `reasoningEffort`, Gemini `thinkingConfig`, OpenRouter `reasoning`, Bedrock `reasoningConfig`).
 */
function resolveThinking(
	provider: LlmProvider,
	modelId: string,
	capabilities: ModelCapabilities | undefined,
	settings: ModelInferenceSettings,
): ThinkingResult {
	const mode = capabilities?.thinking;
	if (mode === undefined || mode === 'none') {
		return THINKING_INACTIVE;
	}

	const stored = settings.reasoningEffort;
	const effort = stored && stored !== 'off' ? clampEffort(stored, capabilities?.effortOptions) : undefined;

	if (isAnthropicApiModel(provider, modelId)) {
		return provider === 'bedrock'
			? resolveBedrockThinking(capabilities, effort, settings)
			: resolveAnthropicThinking(capabilities, effort, settings);
	}

	switch (provider) {
		case 'openai':
		case 'azure':
			return resolveEffortThinking(effort, (e) => ({ reasoningEffort: EFFORT_TO_OPENAI[e] }));
		case 'openrouter':
			return resolveEffortThinking(effort, (e) => ({
				reasoning: { enabled: true, effort: EFFORT_TO_OPENAI[e] },
			}));
		case 'google':
		case 'vertex':
			return resolveGeminiThinking(capabilities, effort, settings);
		default:
			return THINKING_INACTIVE;
	}
}

function resolveAnthropicThinking(
	capabilities: ModelCapabilities | undefined,
	effort: ActiveEffort | undefined,
	settings: ModelInferenceSettings,
): ThinkingResult {
	if (capabilities?.thinking === 'adaptive' && effort) {
		return {
			providerOverrides: { thinking: { type: 'adaptive' }, effort: EFFORT_TO_ANTHROPIC[effort] },
			thinkingActive: true,
		};
	}
	if (capabilities?.thinking === 'budget' && settings.thinkingBudgetTokens !== undefined) {
		const budget = fitBudget(settings.thinkingBudgetTokens, capabilities.maxOutputCap);
		if (budget === undefined) {
			return THINKING_INACTIVE;
		}
		return {
			providerOverrides: { thinking: { type: 'enabled', budgetTokens: budget } },
			thinkingActive: true,
		};
	}
	return THINKING_INACTIVE;
}

function resolveBedrockThinking(
	capabilities: ModelCapabilities | undefined,
	effort: ActiveEffort | undefined,
	settings: ModelInferenceSettings,
): ThinkingResult {
	if (capabilities?.thinking === 'adaptive' && effort) {
		return {
			providerOverrides: {
				reasoningConfig: { type: 'adaptive', maxReasoningEffort: EFFORT_TO_BEDROCK[effort] },
			},
			thinkingActive: true,
		};
	}
	if (capabilities?.thinking === 'budget' && settings.thinkingBudgetTokens !== undefined) {
		const budget = fitBudget(settings.thinkingBudgetTokens, capabilities.maxOutputCap);
		if (budget === undefined) {
			return THINKING_INACTIVE;
		}
		return {
			providerOverrides: { reasoningConfig: { type: 'enabled', budgetTokens: budget } },
			thinkingActive: true,
		};
	}
	return THINKING_INACTIVE;
}

function resolveGeminiThinking(
	capabilities: ModelCapabilities | undefined,
	effort: ActiveEffort | undefined,
	settings: ModelInferenceSettings,
): ThinkingResult {
	if (capabilities?.thinking === 'adaptive' && effort) {
		return {
			providerOverrides: { thinkingConfig: { thinkingLevel: EFFORT_TO_GEMINI_LEVEL[effort] } },
			thinkingActive: true,
		};
	}
	if (capabilities?.thinking === 'budget' && settings.thinkingBudgetTokens !== undefined) {
		const range = capabilities.thinkingBudgetRange;
		const budget = range
			? clampNumber(settings.thinkingBudgetTokens, range.min, range.max)
			: settings.thinkingBudgetTokens;
		return {
			providerOverrides: { thinkingConfig: { thinkingBudget: budget } },
			thinkingActive: true,
		};
	}
	return THINKING_INACTIVE;
}

/** Shared adaptive-effort translator: emits the given override only when a non-off effort is set. */
function resolveEffortThinking(
	effort: ActiveEffort | undefined,
	toOverrides: (effort: ActiveEffort) => Record<string, unknown>,
): ThinkingResult {
	if (!effort) {
		return THINKING_INACTIVE;
	}
	return { providerOverrides: toOverrides(effort), thinkingActive: true };
}

/**
 * Translate the extra provider-specific settings a model declares via `extraParams` into
 * provider option overrides. Values for params the model doesn't declare are ignored, so a
 * stale stored value can never reach a provider that rejects it. Most keys map 1:1 onto the
 * provider option of the same name; the exceptions are Anthropic's inverted
 * `disableParallelToolUse`, Gemini's nested `thinkingConfig.includeThoughts` and its
 * top-level safety `threshold`.
 */
function resolveExtraOptions(
	provider: LlmProvider,
	modelId: string,
	capabilities: ModelCapabilities | undefined,
	settings: ModelInferenceSettings,
): Record<string, unknown> | undefined {
	const extraParams = capabilities?.extraParams;
	if (!extraParams?.length) {
		return undefined;
	}

	const overrides: Record<string, unknown> = {};
	for (const key of extraParams) {
		const value = settings[key];
		if (value === undefined) {
			continue;
		}
		if (key === 'parallelToolCalls' && isAnthropicApiModel(provider, modelId)) {
			overrides.disableParallelToolUse = !value;
		} else if (key === 'includeThoughts') {
			overrides.thinkingConfig = { includeThoughts: value };
		} else if (key === 'safetyThreshold') {
			overrides.threshold = value;
		} else {
			overrides[key] = value;
		}
	}
	return Object.keys(overrides).length > 0 ? overrides : undefined;
}

/** Shallow merge of provider overrides, deep-merging the nested Gemini `thinkingConfig`. */
function mergeProviderOverrides(
	thinkingOverrides?: Record<string, unknown>,
	extraOverrides?: Record<string, unknown>,
): Record<string, unknown> | undefined {
	if (!thinkingOverrides || !extraOverrides) {
		return thinkingOverrides ?? extraOverrides;
	}
	const merged = { ...thinkingOverrides, ...extraOverrides };
	const a = thinkingOverrides.thinkingConfig;
	const b = extraOverrides.thinkingConfig;
	if (a && b && typeof a === 'object' && typeof b === 'object') {
		merged.thinkingConfig = { ...a, ...b };
	}
	return merged;
}

function getProviderModelConfig<P extends LlmProvider>(provider: P, modelId: string): ProviderConfigMap[P] {
	const model = LLM_PROVIDERS[provider].models.find((m) => m.id === modelId);
	return (model?.config ?? {}) as ProviderConfigMap[P];
}

/** Build googleAuthOptions from service account JSON, key file path, or env vars */
function buildVertexAuthOptions(creds?: Record<string, string>) {
	const json = creds?.serviceAccountJson || process.env.VERTEX_GOOGLE_SERVICE_ACCOUNT_JSON;
	if (json) {
		try {
			const sa = JSON.parse(json);
			if (sa.client_email && sa.private_key) {
				return { credentials: { client_email: sa.client_email, private_key: sa.private_key } };
			}
		} catch {
			// fall through
		}
	}

	const keyFile = creds?.keyFile || process.env.VERTEX_GOOGLE_APPLICATION_CREDENTIALS;
	if (keyFile) {
		return { keyFile };
	}

	return undefined;
}

const BEDROCK_REGION_PREFIXES = new Set(['us', 'eu', 'ap']);
const BEDROCK_CROSS_REGION_PROVIDERS = new Set(['anthropic', 'meta']);

function getBedrockRegionPrefix(region: string): string {
	const geo = region.split('-')[0];
	return BEDROCK_REGION_PREFIXES.has(geo) ? geo : 'us';
}

/** Ensure cross-region inference models use the correct geographic prefix for the target region. */
function resolveBedrockModelId(modelId: string, region: string): string {
	const prefix = getBedrockRegionPrefix(region);
	const firstSegment = modelId.split('.')[0];
	if (BEDROCK_REGION_PREFIXES.has(firstSegment)) {
		const rest = modelId.slice(firstSegment.length + 1);
		return firstSegment === prefix ? modelId : `${prefix}.${rest}`;
	}
	if (BEDROCK_CROSS_REGION_PROVIDERS.has(firstSegment)) {
		return `${prefix}.${modelId}`;
	}
	return modelId;
}
