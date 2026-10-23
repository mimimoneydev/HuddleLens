import test from 'node:test';
import assert from 'node:assert/strict';
import {createMockSnapshot, normalizeApiFootballFixture, normalizeGenericFeed, createSportsService} from '../server/sports.mjs';

test('API-Football fixture is normalized into the HuddleLens contract', () => {
  const snapshot = normalizeApiFootballFixture({response: [{fixture: {id: 42, status: {elapsed: 67, short: '2H'}, timestamp: 10}, league: {name: 'Cup'}, teams: {home: {name: 'North'}, away: {name: 'Harbor'}}, goals: {home: 2, away: 1}, events: [{time: {elapsed: 66}, team: {name: 'North'}, player: {name: 'Maya'}, type: 'Goal', detail: 'Normal Goal'}]}]});
  assert.equal(snapshot.match.homeScore, 2);
  assert.equal(snapshot.events[0].player, 'Maya');
  assert.equal(snapshot.events[0].minute, 66);
});

test('generic licensed provider payload is validated and normalized', () => {
  const result = normalizeGenericFeed({match: {id: 'x', home: 'A', away: 'B', homeScore: 1, awayScore: 0}, events: [{minute: 2, type: 'Kick Off'}]});
  assert.equal(result.match.homeCode, 'A');
  assert.equal(result.events[0].sport, 'football');
  assert.throws(() => normalizeGenericFeed({match: {home: 'A'}}), /requires/);
});

test('mock provider evolves deterministically for simulator reliability', () => {
  const startedAt = 1_000;
  assert.equal(createMockSnapshot(startedAt, startedAt).events.length, 1);
  assert.equal(createMockSnapshot(startedAt + 36_000, startedAt).events.length, 3);
});

test('generic sports service calls the configured feed without exposing its key', async () => {
  let authorization = '';
  const service = createSportsService({provider: 'generic', feedUrl: 'https://feed.invalid/match', fetchImpl: async (_url, options) => {
    authorization = options.headers.Authorization || '';
    return Response.json({match: {home: 'A', away: 'B'}, events: []});
  }});
  await service.refresh();
  assert.equal(service.getSnapshot().match.home, 'A');
  assert.equal(service.status().connected, true);
  assert.equal(authorization, '');
});
