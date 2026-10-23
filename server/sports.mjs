import {plays} from '../src/logic.mjs';

function eventId(event, index = 0) {
  return String(event.id || `${event.minute || 0}-${event.type || event.event || 'event'}-${event.player || event.team || index}`)
    .toLowerCase().replace(/[^a-z0-9-]+/g, '-');
}

export function normalizeApiFootballFixture(payload) {
  const fixture = payload?.response?.[0];
  if (!fixture) throw new Error('API-Football returned no fixture');
  const home = fixture.teams?.home?.name || 'Home';
  const away = fixture.teams?.away?.name || 'Away';
  return {
    match: {
      id: String(fixture.fixture?.id || ''), sport: 'football', league: fixture.league?.name || 'Live match',
      home, away, homeCode: home.slice(0, 3).toUpperCase(), awayCode: away.slice(0, 3).toUpperCase(),
      homeScore: Number(fixture.goals?.home) || 0, awayScore: Number(fixture.goals?.away) || 0,
      minute: Number(fixture.fixture?.status?.elapsed) || 0,
      status: fixture.fixture?.status?.short || 'LIVE', venue: fixture.fixture?.venue?.name || '',
      updatedAt: new Date().toISOString(),
    },
    events: (fixture.events || []).map((event, index) => ({
      id: eventId(event, index), sport: 'football', minute: Number(event.time?.elapsed) || 0,
      extraMinute: Number(event.time?.extra) || 0, team: event.team?.name || '', player: event.player?.name || '',
      assist: event.assist?.name || '', type: event.type || 'Event', detail: event.detail || '',
      comments: event.comments || '', x: null, y: null, updatedAt: fixture.fixture?.timestamp || Date.now(),
    })),
  };
}

export function normalizeGenericFeed(payload) {
  const match = payload.match || payload;
  const events = payload.events || match.events || [];
  if (!match.home || !match.away) throw new Error('Generic feed requires match.home and match.away');
  return {
    match: {
      id: String(match.id || 'live'), sport: match.sport || 'football', league: match.league || 'Live match',
      home: match.home, away: match.away,
      homeCode: match.homeCode || match.home.slice(0, 3).toUpperCase(),
      awayCode: match.awayCode || match.away.slice(0, 3).toUpperCase(),
      homeScore: Number(match.homeScore) || 0, awayScore: Number(match.awayScore) || 0,
      minute: Number(match.minute) || 0, status: match.status || 'LIVE', venue: match.venue || '',
      updatedAt: match.updatedAt || new Date().toISOString(),
    },
    events: events.map((event, index) => ({
      ...event, id: eventId(event, index), sport: event.sport || match.sport || 'football',
      minute: Number(event.minute) || 0, updatedAt: event.updatedAt || Date.now(),
    })),
  };
}

export function createMockSnapshot(now = Date.now(), startedAt = now) {
  const elapsedSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const visibleCount = Math.min(plays.length, 1 + Math.floor(elapsedSeconds / 18));
  const events = plays.slice(0, visibleCount).map((play, index) => ({
    id: `mock-${index + 1}`, sport: 'football', minute: play.minute, team: play.team,
    player: index === 0 ? 'Maya / Imani' : index === 1 ? 'Harbor goalkeeper' : 'Northstar attack',
    type: play.event, detail: play.title, comments: play.summary, x: play.x, y: play.y,
    impact: play.impact, challenge: play.challenge, target: play.target, updatedAt: startedAt + index * 18_000,
  }));
  return {
    match: {
      id: 'northstar-harbor', sport: 'football', league: "Women's Champions Cup · Semi-final",
      home: 'Northstar', away: 'Harbor', homeCode: 'NST', awayCode: 'HBR', homeScore: 1, awayScore: 0,
      minute: 44, status: 'LIVE', venue: 'Huddle Arena', updatedAt: new Date(now).toISOString(), mock: true,
    },
    events,
  };
}

export function createSportsService({
  provider = process.env.SPORTS_PROVIDER || 'mock',
  feedUrl = process.env.SPORTS_FEED_URL || '',
  apiFootballKey = process.env.API_FOOTBALL_KEY || '',
  fixtureId = process.env.API_FOOTBALL_FIXTURE_ID || '',
  pollMs = Number(process.env.SPORTS_POLL_MS) || 15_000,
  fetchImpl = globalThis.fetch,
  clock = Date.now,
} = {}) {
  const startedAt = clock();
  let snapshot = createMockSnapshot(startedAt, startedAt);
  let lastError = null;
  let timer = null;
  const listeners = new Set();

  async function load() {
    if (provider === 'mock') return createMockSnapshot(clock(), startedAt);
    if (provider === 'api-football') {
      if (!apiFootballKey || !fixtureId) throw new Error('API_FOOTBALL_KEY and API_FOOTBALL_FIXTURE_ID are required');
      const response = await fetchImpl(`https://v3.football.api-sports.io/fixtures?id=${encodeURIComponent(fixtureId)}`, {
        headers: {'x-apisports-key': apiFootballKey}, signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`API-Football request failed (${response.status})`);
      return normalizeApiFootballFixture(await response.json());
    }
    if (provider === 'generic') {
      if (!feedUrl) throw new Error('SPORTS_FEED_URL is required for the generic provider');
      const response = await fetchImpl(feedUrl, {headers: process.env.SPORTS_FEED_KEY ? {Authorization: `Bearer ${process.env.SPORTS_FEED_KEY}`} : {}, signal: AbortSignal.timeout(10_000)});
      if (!response.ok) throw new Error(`Sports feed request failed (${response.status})`);
      return normalizeGenericFeed(await response.json());
    }
    throw new Error(`Unsupported sports provider: ${provider}`);
  }

  async function refresh() {
    try {
      const next = await load();
      const changed = JSON.stringify(next) !== JSON.stringify(snapshot);
      snapshot = next; lastError = null;
      if (changed) for (const listener of listeners) listener({type: 'snapshot', ...snapshot});
    } catch (error) {
      lastError = error.message;
      for (const listener of listeners) listener({type: 'error', message: lastError});
    }
    return snapshot;
  }

  function start() {
    if (timer) return;
    refresh();
    timer = setInterval(refresh, Math.max(5_000, pollMs));
    timer.unref?.();
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  function status() { return {provider, connected: !lastError, lastError, lastUpdated: snapshot.match.updatedAt}; }

  return {start, stop, refresh, subscribe, getSnapshot: () => snapshot, status};
}
