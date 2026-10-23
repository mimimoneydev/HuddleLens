import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpenRouterService, normalizeModel, parseExplanation, DEFAULT_MODEL} from '../server/openrouter.mjs';

test('OpenRouter prices are normalized to dollars per million tokens', () => {
  const model = normalizeModel({id: 'test/model', name: 'Test', context_length: 64000, pricing: {prompt: '0.000001', completion: '0.000003'}, architecture: {output_modalities: ['text']}});
  assert.equal(model.inputPricePerMillion, 1);
  assert.equal(model.outputPricePerMillion, 3);
  assert.equal(model.contextLength, 64000);
});

test('explanation JSON fences are accepted and validated', () => {
  const value = parseExplanation('```json\n{"title":"Shape change","summary":"A run opened space.","watchCue":"Track the runner.","tacticalSteps":["Freeze"],"challenge":"Side step."}\n```');
  assert.equal(value.title, 'Shape change');
  assert.throws(() => parseExplanation('{"title":"Incomplete"}'), /Missing summary/);
});

test('model catalog and explanation calls use server-side OpenRouter API', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({url, options});
    if (url.endsWith('/models')) return Response.json({data: [{id: DEFAULT_MODEL, name: 'DeepSeek', pricing: {prompt: '0.0000002', completion: '0.0000008'}, architecture: {output_modalities: ['text']}}]});
    return Response.json({model: DEFAULT_MODEL, choices: [{message: {content: '{"title":"A live explanation","summary":"The run moved a defender.","watchCue":"Watch the runner.","tacticalSteps":["Track","Pause"],"challenge":"Step left and right."}'}}], usage: {total_tokens: 80}});
  };
  const service = createOpenRouterService({apiKey: 'server-secret', fetchImpl});
  const models = await service.listModels();
  const result = await service.explain({id: 'event-1', type: 'Goal', team: 'Northstar'});
  assert.equal(models[0].inputPricePerMillion, 0.2);
  assert.equal(result.source, 'openrouter');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer server-secret');
  assert.ok(!JSON.stringify(result).includes('server-secret'));
});

test('missing key produces an event-grounded local fallback', async () => {
  const service = createOpenRouterService({apiKey: ''});
  const result = await service.explain({id: 'e', type: 'SAVE', player: 'Ari', minute: 22}, {level: 'fan'});
  assert.equal(result.source, 'local-fallback');
  assert.match(result.summary, /Ari/);
});
