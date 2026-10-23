import test from 'node:test';
import assert from 'node:assert/strict';
import {createBedrockService, DEFAULT_BEDROCK_MODEL, normalizeBedrockResponse} from '../server/bedrock.mjs';

const event = {id: 'e1', type: 'goal', minute: 18, team: 'Northstar', player: 'Maya', detail: 'Maya scores'};
const payload = {title: 'Why it worked', summary: 'A quick run created space.', watchCue: 'Watch the run.', tacticalSteps: ['Move wide'], challenge: 'Mirror the run.'};

test('Bedrock Converse response is normalized with usage telemetry', () => {
  const result = normalizeBedrockResponse({
    output: {message: {content: [{text: JSON.stringify(payload)}]}},
    usage: {inputTokens: 21, outputTokens: 34, totalTokens: 55}, metrics: {latencyMs: 140},
  }, DEFAULT_BEDROCK_MODEL);
  assert.equal(result.provider, 'bedrock');
  assert.equal(result.usage.total_tokens, 55);
  assert.equal(result.title, payload.title);
});

test('Bedrock uses Converse with Nova 2 Lite and structured JSON', async () => {
  let command;
  const service = createBedrockService({client: {send: async input => {
    command = input;
    return {output: {message: {content: [{text: JSON.stringify(payload)}]}}};
  }}});
  const result = await service.explain(event, {level: 'fan'});
  assert.equal(result.model, DEFAULT_BEDROCK_MODEL);
  assert.equal(command.input.modelId, DEFAULT_BEDROCK_MODEL);
  assert.equal(command.input.outputConfig.textFormat.type, 'json_schema');
});

test('Bedrock retries without structured output when a runtime does not support it', async () => {
  const commands = [];
  const service = createBedrockService({client: {send: async command => {
    commands.push(command);
    if (commands.length === 1) throw Object.assign(new Error('Unsupported field'), {name: 'ValidationException'});
    return {output: {message: {content: [{text: JSON.stringify(payload)}]}}};
  }}});
  const result = await service.explain(event);
  assert.equal(result.source, 'bedrock');
  assert.equal(commands.length, 2);
  assert.equal(commands[1].input.outputConfig, undefined);
});
