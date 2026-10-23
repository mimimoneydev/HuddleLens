export const DEFAULT_MODEL = 'deepseek/deepseek-v4.1-flash-1017';
export const OPENROUTER_URL = 'https://openrouter.ai/api/v1';

const MODEL_CACHE_MS = 15 * 60 * 1000;
const EXPLANATION_CACHE_MS = 5 * 60 * 1000;

export function normalizePrice(value) {
  const perToken = Number(value);
  return Number.isFinite(perToken) ? Number((perToken * 1_000_000).toFixed(12)) : null;
}

export function normalizeModel(model) {
  return {
    id: model.id,
    name: model.name || model.id,
    contextLength: Number(model.context_length) || 0,
    inputPricePerMillion: normalizePrice(model.pricing?.prompt),
    outputPricePerMillion: normalizePrice(model.pricing?.completion),
    imagePrice: Number(model.pricing?.image) || null,
    inputModalities: model.architecture?.input_modalities || [],
    outputModalities: model.architecture?.output_modalities || [],
    supportedParameters: model.supported_parameters || [],
  };
}

export function parseExplanation(content) {
  if (typeof content === 'object' && content) return content;
  const cleaned = String(content || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(cleaned);
  for (const key of ['title', 'summary', 'watchCue']) {
    if (typeof parsed[key] !== 'string' || !parsed[key].trim()) throw new Error(`Missing ${key}`);
  }
  parsed.tacticalSteps = Array.isArray(parsed.tacticalSteps) ? parsed.tacticalSteps.slice(0, 4) : [];
  parsed.challenge = typeof parsed.challenge === 'string' ? parsed.challenge : 'Mirror the key movement safely.';
  return parsed;
}

export function localExplanation(event, level) {
  const actor = event.player || event.team || 'The attacking side';
  const eventName = String(event.type || 'play').toLowerCase();
  const position = Number.isFinite(event.x) && Number.isFinite(event.y)
    ? ` near the ${event.x > 66 ? 'final third' : event.x < 34 ? 'defensive third' : 'middle third'}`
    : '';
  const detail = level === 'coach'
    ? 'The timing changed the defensive shape and created the next passing decision.'
    : level === 'fan'
      ? 'Watch how the nearest defenders react before the next touch.'
      : 'It changed where the next safe space appeared.';
  return {
    title: `${actor}'s ${eventName} changed the picture`,
    summary: `${actor} influenced the play${position}. ${detail}`,
    watchCue: `Follow ${actor} immediately before and after the ${eventName}.`,
    tacticalSteps: ['Freeze the moment before the event', 'Track the nearest defender', 'Notice the space created next'],
    challenge: 'Take two quick side steps, reset, and repeat.',
    source: 'local-fallback',
  };
}

export function createOpenRouterService({
  apiKey = process.env.OPENROUTER_API_KEY || '',
  baseUrl = process.env.OPENROUTER_BASE_URL || OPENROUTER_URL,
  defaultModel = process.env.OPENROUTER_DEFAULT_MODEL || DEFAULT_MODEL,
  fetchImpl = globalThis.fetch,
  appUrl = process.env.PUBLIC_APP_URL || 'http://localhost:4173',
} = {}) {
  let modelCache = null;
  let modelCacheAt = 0;
  const explanationCache = new Map();

  const headers = () => ({
    ...(apiKey ? {Authorization: `Bearer ${apiKey}`} : {}),
    'Content-Type': 'application/json',
    'HTTP-Referer': appUrl,
    'X-Title': 'HuddleLens for Fire TV',
  });

  async function listModels({force = false} = {}) {
    if (!force && modelCache && Date.now() - modelCacheAt < MODEL_CACHE_MS) return modelCache;
    const response = await fetchImpl(`${baseUrl}/models`, {headers: headers(), signal: AbortSignal.timeout(10_000)});
    if (!response.ok) throw new Error(`OpenRouter models request failed (${response.status})`);
    const payload = await response.json();
    modelCache = (payload.data || [])
      .filter(model => !model.architecture?.output_modalities || model.architecture.output_modalities.includes('text'))
      .map(normalizeModel)
      .sort((a, b) => a.name.localeCompare(b.name));
    modelCacheAt = Date.now();
    return modelCache;
  }

  async function explain(event, {level = 'rookie', model = defaultModel} = {}) {
    const cacheKey = JSON.stringify([event.id, event.updatedAt, level, model]);
    const cached = explanationCache.get(cacheKey);
    if (cached && Date.now() - cached.createdAt < EXPLANATION_CACHE_MS) return {...cached.value, cached: true};
    if (!apiKey) return {...localExplanation(event, level), model, reason: 'OPENROUTER_API_KEY is not configured'};
    const availableModels = await listModels();
    if (!availableModels.some(item => item.id === model)) throw new Error(`OpenRouter model is not available: ${model}`);

    const schema = {
      type: 'object', additionalProperties: false,
      properties: {
        title: {type: 'string'},
        summary: {type: 'string'},
        watchCue: {type: 'string'},
        tacticalSteps: {type: 'array', maxItems: 4, items: {type: 'string'}},
        challenge: {type: 'string'},
      },
      required: ['title', 'summary', 'watchCue', 'tacticalSteps', 'challenge'],
    };
    const request = {
      model,
      temperature: 0.25,
      max_completion_tokens: 450,
      usage: {include: true},
      response_format: {type: 'json_schema', json_schema: {name: 'sports_explanation', strict: true, schema}},
      messages: [
        {
          role: 'system',
          content: 'You are HuddleLens, a concise live-sports explainer for a family television. Use only supplied event facts. Never invent a player, score, measurement, rule decision, injury, or statistic. Explain one causal idea. Keep the summary under 55 words and every other field under 18 words. Be inclusive and avoid medical or gambling advice.',
        },
        {
          role: 'user',
          content: JSON.stringify({sport: event.sport || 'football', audienceLevel: level, event}),
        },
      ],
    };
    const response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST', headers: headers(), body: JSON.stringify(request), signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`OpenRouter explanation failed (${response.status}): ${detail}`);
    }
    const payload = await response.json();
    const value = {
      ...parseExplanation(payload.choices?.[0]?.message?.content),
      source: 'openrouter',
      model: payload.model || model,
      usage: payload.usage || null,
    };
    explanationCache.set(cacheKey, {createdAt: Date.now(), value});
    return value;
  }

  return {defaultModel, hasApiKey: Boolean(apiKey), listModels, explain, localExplanation};
}
