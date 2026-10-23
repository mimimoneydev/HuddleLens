import {BedrockRuntimeClient, ConverseCommand} from '@aws-sdk/client-bedrock-runtime';
import {fromNodeProviderChain} from '@aws-sdk/credential-providers';
import {parseExplanation} from './openrouter.mjs';

export const DEFAULT_BEDROCK_MODEL = 'global.amazon.nova-2-lite-v1:0';

function optionalNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null;
}

export const explanationSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    title: {type: 'string'}, summary: {type: 'string'}, watchCue: {type: 'string'},
    tacticalSteps: {type: 'array', maxItems: 4, items: {type: 'string'}}, challenge: {type: 'string'},
  },
  required: ['title', 'summary', 'watchCue', 'tacticalSteps', 'challenge'],
};

export function normalizeBedrockResponse(response, model) {
  const content = response?.output?.message?.content || [];
  const text = content.find(item => typeof item.text === 'string')?.text;
  if (!text) throw new Error('Amazon Bedrock returned no explanation text');
  return {
    ...parseExplanation(text), source: 'bedrock', provider: 'bedrock', model,
    usage: response.usage ? {
      input_tokens: response.usage.inputTokens || 0,
      output_tokens: response.usage.outputTokens || 0,
      total_tokens: response.usage.totalTokens || (response.usage.inputTokens || 0) + (response.usage.outputTokens || 0),
    } : null,
    latencyMs: response.metrics?.latencyMs || null,
  };
}

export function createBedrockService({
  region = process.env.AWS_REGION || 'us-east-1',
  defaultModel = process.env.BEDROCK_DEFAULT_MODEL || DEFAULT_BEDROCK_MODEL,
  guardrailId = process.env.BEDROCK_GUARDRAIL_ID || '',
  guardrailVersion = process.env.BEDROCK_GUARDRAIL_VERSION || '',
  client = null,
} = {}) {
  const runtime = client || new BedrockRuntimeClient({region, credentials: fromNodeProviderChain(), maxAttempts: 2});
  let lastError = null;
  let lastSuccessAt = null;

  function listModels() {
    return [{
      id: defaultModel, name: 'Amazon Nova 2 Lite', provider: 'bedrock', contextLength: 1_000_000,
      inputPricePerMillion: optionalNumber(process.env.BEDROCK_INPUT_PRICE_PER_MILLION),
      outputPricePerMillion: optionalNumber(process.env.BEDROCK_OUTPUT_PRICE_PER_MILLION),
      inputModalities: ['text', 'image', 'video'], outputModalities: ['text'],
    }];
  }

  async function sendConverse(event, level, model, structured = true) {
    const system = 'You are HuddleLens, a concise live-sports explainer for a family television. Use only supplied event facts. Never invent a player, score, measurement, rule decision, injury, or statistic. Explain one causal idea. Return only valid JSON. Keep the summary under 55 words and every other field under 18 words. Be inclusive and avoid medical or gambling advice.';
    const input = {
      modelId: model,
      system: [{text: system}],
      messages: [{role: 'user', content: [{text: JSON.stringify({sport: event.sport || 'football', audienceLevel: level, event, requiredJsonSchema: explanationSchema})}]}],
      inferenceConfig: {maxTokens: 450, temperature: 0.25},
      ...(guardrailId && guardrailVersion ? {guardrailConfig: {guardrailIdentifier: guardrailId, guardrailVersion, trace: 'enabled'}} : {}),
      ...(structured ? {outputConfig: {textFormat: {type: 'json_schema', structure: {jsonSchema: {
        schema: JSON.stringify(explanationSchema), name: 'sports_explanation', description: 'A grounded HuddleLens sports explanation',
      }}}}} : {}),
    };
    return runtime.send(new ConverseCommand(input));
  }

  async function explain(event, {level = 'rookie', model = defaultModel} = {}) {
    if (!listModels().some(item => item.id === model)) throw new Error(`Amazon Bedrock model is not allowed: ${model}`);
    try {
      let response;
      try { response = await sendConverse(event, level, model, true); }
      catch (error) {
        if (!['ValidationException', 'BadRequestException'].includes(error.name)) throw error;
        response = await sendConverse(event, level, model, false);
      }
      const result = normalizeBedrockResponse(response, model);
      lastError = null; lastSuccessAt = new Date().toISOString();
      return result;
    } catch (error) {
      lastError = `${error.name || 'BedrockError'}: ${error.message}`;
      throw error;
    }
  }

  return {
    id: 'bedrock', name: 'Amazon Bedrock', defaultModel, region, configured: true,
    guardrailsEnabled: Boolean(guardrailId && guardrailVersion), listModels, explain,
    status: () => ({provider: 'bedrock', configured: true, region, defaultModel, guardrailsEnabled: Boolean(guardrailId && guardrailVersion), lastError, lastSuccessAt}),
  };
}
