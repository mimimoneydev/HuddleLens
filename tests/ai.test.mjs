import test from 'node:test';
import assert from 'node:assert/strict';
import {createAIService} from '../server/ai.mjs';

const event = {id: 'e1', type: 'goal', minute: 18, team: 'Northstar', player: 'Maya', detail: 'Maya scores'};
const result = provider => ({title: 'Title', summary: 'Summary', watchCue: 'Cue', tacticalSteps: [], challenge: 'Move', source: provider, model: `${provider}-model`});
const service = (name, explain, configured = true) => ({defaultModel: `${name}-model`, hasApiKey: configured, explain, listModels: () => [], status: () => ({configured, defaultModel: `${name}-model`})});

test('auto routing uses Bedrock first', async () => {
  let openrouterCalls = 0;
  const ai = createAIService({
    bedrock: service('bedrock', async () => result('bedrock')),
    openrouter: service('openrouter', async () => { openrouterCalls += 1; return result('openrouter'); }),
  });
  const response = await ai.explain(event);
  assert.equal(response.provider, 'bedrock');
  assert.equal(openrouterCalls, 0);
});

test('auto routing fails over from Bedrock to OpenRouter', async () => {
  const ai = createAIService({
    bedrock: service('bedrock', async () => { throw new Error('AWS unavailable'); }),
    openrouter: service('openrouter', async () => result('openrouter')),
  });
  const response = await ai.explain(event);
  assert.equal(response.provider, 'openrouter');
  assert.deepEqual(response.attempts.map(attempt => attempt.ok), [false, true]);
});

test('both remote providers failing returns grounded local explanation', async () => {
  const ai = createAIService({
    bedrock: service('bedrock', async () => { throw new Error('AWS unavailable'); }),
    openrouter: service('openrouter', async () => result('openrouter'), false),
  });
  const response = await ai.explain(event);
  assert.equal(response.provider, 'local-fallback');
  assert.equal(response.source, 'local-fallback');
  assert.equal(response.attempts.length, 2);
});
