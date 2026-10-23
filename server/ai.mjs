import {localExplanation} from './openrouter.mjs';

export const DEFAULT_PROVIDER = 'auto';

function safeError(error) {
  return {name: error?.name || 'ProviderError', message: String(error?.message || 'Provider failed').slice(0, 240), status: error?.$metadata?.httpStatusCode || null};
}

export function createAIService({bedrock, openrouter, defaultProvider = process.env.AI_PROVIDER || DEFAULT_PROVIDER} = {}) {
  if (!bedrock || !openrouter) throw new Error('Bedrock and OpenRouter services are required');
  let lastRoute = null;

  async function tryProvider(provider, event, options) {
    if (provider === 'bedrock') return bedrock.explain(event, {...options, model: options.models?.bedrock || bedrock.defaultModel});
    if (provider === 'openrouter') {
      if (!openrouter.hasApiKey) throw Object.assign(new Error('OPENROUTER_API_KEY is not configured'), {name: 'ProviderNotConfigured'});
      return openrouter.explain(event, {...options, model: options.models?.openrouter || openrouter.defaultModel});
    }
    throw new Error(`Unsupported AI provider: ${provider}`);
  }

  async function explain(event, {provider = defaultProvider, level = 'rookie', models = {}} = {}) {
    const requested = ['auto', 'bedrock', 'openrouter'].includes(provider) ? provider : defaultProvider;
    const route = requested === 'auto' ? ['bedrock', 'openrouter'] : [requested];
    const attempts = [];
    for (const candidate of route) {
      const startedAt = Date.now();
      try {
        const result = await tryProvider(candidate, event, {level, models});
        attempts.push({provider: candidate, ok: true, durationMs: Date.now() - startedAt});
        lastRoute = {requested, used: candidate, attempts, at: new Date().toISOString()};
        return {...result, provider: candidate, requestedProvider: requested, attempts};
      } catch (error) {
        attempts.push({provider: candidate, ok: false, durationMs: Date.now() - startedAt, error: safeError(error)});
      }
    }
    const fallback = localExplanation(event, level);
    lastRoute = {requested, used: 'local-fallback', attempts, at: new Date().toISOString()};
    return {...fallback, provider: 'local-fallback', requestedProvider: requested, attempts, model: null};
  }

  function catalog() {
    return {
      defaultProvider, primaryProvider: 'bedrock', fallbackProvider: 'openrouter',
      providers: [
        {id: 'bedrock', name: 'Amazon Bedrock', defaultModel: bedrock.defaultModel, models: bedrock.listModels(), status: bedrock.status()},
        {id: 'openrouter', name: 'OpenRouter', defaultModel: openrouter.defaultModel, models: [], status: {configured: openrouter.hasApiKey}},
      ],
    };
  }

  return {defaultProvider, explain, catalog, status: () => ({defaultProvider, primaryProvider: 'bedrock', fallbackProvider: 'openrouter', lastRoute, bedrock: bedrock.status(), openrouter: {configured: openrouter.hasApiKey}})};
}
