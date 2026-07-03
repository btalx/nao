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
	ModelInferenceSettings,
	ModelThinkingMode,
	ProviderConfigMap,
	ProviderSettings,
} from '../types/llm';
import { getModelCapabilities, PROVIDER_META } from './provider-meta';

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

	return {
		model: providerConfig.create(settings, modelId),
		providerOptions: {
			[provider]: { ...defaultOptions, ...modelConfig, ...providerOverrides },
		},
		contextWindow,
		callSettings,
	};
}

/**
 * Translate normalized per-model inference settings into AI SDK call settings and
 * provider-specific option overrides, based on the model's declared capabilities.
 * Sampling parameters (temperature/topP/topK) are dropped for Anthropic when thinking is
 * active, since the Messages API rejects them alongside thinking.
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
	const { providerOverrides, thinkingActive } = resolveThinking(provider, capabilities?.thinking, settings);

	const callSettings: ModelCallSettings = {};
	if (settings.maxOutputTokens !== undefined) {
		callSettings.maxOutputTokens = settings.maxOutputTokens;
	}
	const dropSampling = provider === 'anthropic' && thinkingActive;
	if (!dropSampling) {
		if (settings.temperature !== undefined) {
			callSettings.temperature = settings.temperature;
		}
		if (settings.topP !== undefined) {
			callSettings.topP = settings.topP;
		}
		if (settings.topK !== undefined) {
			callSettings.topK = settings.topK;
		}
	}

	return {
		callSettings: Object.keys(callSettings).length > 0 ? callSettings : undefined,
		providerOverrides,
	};
}

/**
 * Map the normalized thinking settings onto the provider-specific thinking API that the given
 * model actually supports. Modern Claude (adaptive) requires `thinking: { type: 'adaptive' }`
 * plus an effort level; legacy Claude (budget) requires `thinking: { type: 'enabled', budgetTokens }`.
 */
function resolveThinking(
	provider: LlmProvider,
	thinkingMode: ModelThinkingMode | undefined,
	settings: ModelInferenceSettings,
): { providerOverrides?: AnthropicProviderOptions; thinkingActive: boolean } {
	if (provider !== 'anthropic') {
		return { thinkingActive: false };
	}

	if (thinkingMode === 'adaptive' && settings.reasoningEffort && settings.reasoningEffort !== 'off') {
		return {
			providerOverrides: { thinking: { type: 'adaptive' }, effort: settings.reasoningEffort },
			thinkingActive: true,
		};
	}

	if (thinkingMode === 'budget' && settings.thinkingBudgetTokens !== undefined) {
		return {
			providerOverrides: { thinking: { type: 'enabled', budgetTokens: settings.thinkingBudgetTokens } },
			thinkingActive: true,
		};
	}

	return { thinkingActive: false };
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
