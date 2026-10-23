import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';

test('production server exposes static app, health, live match and AI fallback', {skip: process.env.RUN_INTEGRATION !== '1'}, async t => {
  const port = 4189;
  const child = spawn(process.execPath, ['scripts/serve.mjs'], {
    cwd: process.cwd(),
    env: {...process.env, PORT: String(port), NODE_ENV: 'production', SPORTS_PROVIDER: 'mock', AI_PROVIDER: 'openrouter', OPENROUTER_API_KEY: ''},
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill('SIGTERM'));
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server did not start')), 5000);
    child.stdout.on('data', chunk => { if (String(chunk).includes(`localhost:${port}`)) { clearTimeout(timeout); resolve(); } });
    child.on('exit', code => reject(new Error(`Server exited early (${code})`)));
  });

  const base = `http://127.0.0.1:${port}`;
  const [home, health, match] = await Promise.all([
    fetch(base), fetch(`${base}/api/health`).then(response => response.json()), fetch(`${base}/api/match`).then(response => response.json()),
  ]);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /HUDDLELENS/);
  assert.equal(health.ok, true);
  assert.equal(match.match.home, 'Northstar');

  const explanationResponse = await fetch(`${base}/api/explain`, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({event: match.events[0], level: 'rookie'}),
  });
  const explanation = await explanationResponse.json();
  assert.equal(explanationResponse.status, 200);
  assert.equal(explanation.source, 'local-fallback');
  assert.ok(explanation.title && explanation.summary && explanation.watchCue);
});
