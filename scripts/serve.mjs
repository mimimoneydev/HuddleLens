import {createReadStream, existsSync} from 'node:fs';
import {createServer} from 'node:http';
import {extname, join, normalize, resolve} from 'node:path';
import {createOpenRouterService} from '../server/openrouter.mjs';
import {createBedrockService} from '../server/bedrock.mjs';
import {createAIService} from '../server/ai.mjs';
import {createSportsService} from '../server/sports.mjs';

const production = process.env.NODE_ENV === 'production';
const root = resolve(process.cwd(), production && existsSync('dist/index.html') ? 'dist' : 'src');
const port = Number(process.env.PORT) || 4173;
const streamUrl = process.env.LICENSED_STREAM_URL || '';
const openrouter = createOpenRouterService();
const bedrock = createBedrockService();
const ai = createAIService({bedrock, openrouter});
const sports = createSportsService();
const clients = new Set();
const rateWindows = new Map();
const allowedOrigins = new Set((process.env.HUDDLELENS_ALLOWED_ORIGINS || 'null,http://localhost:4173,http://127.0.0.1:4173').split(',').map(value => value.trim()));
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
};

function json(res, status, value) {
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
  res.end(JSON.stringify(value));
}

async function body(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 65_536) throw new Error('Request body too large');
  }
  return raw ? JSON.parse(raw) : {};
}

function rateLimited(req, limit = 20) {
  const key = req.socket.remoteAddress || 'local';
  const now = Date.now();
  const entry = rateWindows.get(key) || {startedAt: now, count: 0};
  if (now - entry.startedAt > 60_000) { entry.startedAt = now; entry.count = 0; }
  entry.count += 1; rateWindows.set(key, entry);
  return entry.count > limit;
}

function sendEvent(res, event) { res.write(`event: ${event.type || 'snapshot'}\ndata: ${JSON.stringify(event)}\n\n`); }

sports.subscribe(event => { for (const client of clients) sendEvent(client, event); });
sports.start();

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      const origin = req.headers.origin || 'null';
      if (allowedOrigins.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    }
    if (url.pathname === '/api/health') {
      return json(res, 200, {ok: true, ai: ai.status(), sports: sports.status()});
    }
    if (url.pathname === '/api/config') {
      return json(res, 200, {ai: ai.status(), streamUrl, sports: sports.status(), cameraProcessing: 'on-device'});
    }
    if (url.pathname === '/api/match') return json(res, 200, sports.getSnapshot());
    if (url.pathname === '/api/events/stream') {
      res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive'});
      clients.add(res); sendEvent(res, {type: 'snapshot', ...sports.getSnapshot()});
      const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15_000);
      req.on('close', () => { clearInterval(heartbeat); clients.delete(res); });
      return;
    }
    if (url.pathname === '/api/models' && req.method === 'GET') {
      const catalog = ai.catalog();
      if (!openrouter.hasApiKey) {
        const provider = catalog.providers.find(item => item.id === 'openrouter');
        provider.models = [{
          id: openrouter.defaultModel, name: 'DeepSeek V4.1 Flash 1017', provider: 'openrouter', contextLength: 0,
          inputPricePerMillion: null, outputPricePerMillion: null, inputModalities: ['text'], outputModalities: ['text'],
        }];
        provider.warning = 'OPENROUTER_API_KEY is not configured; live catalog and prices are unavailable';
        return json(res, 200, {...catalog, live: false, warning: provider.warning});
      }
      try {
        const openrouterModels = await openrouter.listModels({force: url.searchParams.get('refresh') === '1'});
        catalog.providers.find(provider => provider.id === 'openrouter').models = openrouterModels.map(model => ({...model, provider: 'openrouter'}));
        return json(res, 200, {...catalog, live: true});
      } catch (error) {
        catalog.providers.find(provider => provider.id === 'openrouter').error = error.message;
        return json(res, 200, {...catalog, live: false, warning: error.message});
      }
    }
    if (url.pathname === '/api/explain' && req.method === 'POST') {
      if (rateLimited(req)) return json(res, 429, {error: 'Too many explanation requests. Try again shortly.'});
      const request = await body(req);
      if (!request.event?.id || !request.event?.type) return json(res, 400, {error: 'A valid event is required'});
      const level = ['rookie', 'fan', 'coach'].includes(request.level) ? request.level : 'rookie';
      try {
        return json(res, 200, await ai.explain(request.event, {
          level, provider: request.provider || ai.defaultProvider,
          models: {bedrock: request.models?.bedrock || bedrock.defaultModel, openrouter: request.models?.openrouter || openrouter.defaultModel},
        }));
      } catch (error) {
        return json(res, 502, {error: error.message});
      }
    }
    if (url.pathname.startsWith('/api/')) return json(res, 404, {error: 'API route not found'});

    const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const target = normalize(join(root, relative));
    if (!target.startsWith(root) || !existsSync(target)) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': types[extname(target)] || 'application/octet-stream', 'Cache-Control': production ? 'public, max-age=300' : 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(self)',
    });
    createReadStream(target).pipe(res);
  } catch (error) { json(res, 500, {error: error.message || 'Internal server error'}); }
});

server.listen(port, '0.0.0.0', () => console.log(`HuddleLens ${production ? 'production' : 'development'}: http://localhost:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { sports.stop(); server.close(() => process.exit(0)); });
