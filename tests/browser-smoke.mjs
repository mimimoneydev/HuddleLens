import {spawn} from 'node:child_process';
import {mkdir, rm, writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const root = process.cwd();
const serverPort = 4190;
const chromePort = 9223;
const chromeProfile = '/tmp/huddlelens-browser-smoke';
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
await rm(chromeProfile, {recursive: true, force: true});
await mkdir('demo', {recursive: true});

const server = spawn(process.execPath, ['scripts/serve.mjs'], {
  cwd: root,
  env: {...process.env, PORT: String(serverPort), SPORTS_PROVIDER: 'mock', AI_PROVIDER: 'openrouter', OPENROUTER_API_KEY: ''},
  stdio: ['ignore', 'pipe', 'pipe'],
});
let browser = null;

async function waitFor(check, timeout = 12_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { const result = await check(); if (result) return result; } catch { /* retry during startup */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for browser state');
}

try {
  await new Promise((resolve, reject) => {
    let diagnostics = '';
    const timeout = setTimeout(() => reject(new Error(`Server did not start: ${diagnostics}`)), 5000);
    server.stdout.on('data', chunk => { diagnostics += String(chunk); if (diagnostics.includes(`localhost:${serverPort}`)) { clearTimeout(timeout); resolve(); } });
    server.stderr.on('data', chunk => { diagnostics += String(chunk); });
    server.on('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited (${code}): ${diagnostics}`)); });
  });
  browser = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=1920,1080',
    '--force-device-scale-factor=1', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
    `--remote-debugging-port=${chromePort}`, `--user-data-dir=${chromeProfile}`, 'about:blank',
  ], {stdio: ['ignore', 'ignore', 'ignore']});
  const targets = await waitFor(() => fetch(`http://127.0.0.1:${chromePort}/json`).then(response => response.json()));
  const target = targets.find(item => item.type === 'page');
  assert.ok(target, 'Chrome page target is available');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, {once: true}); socket.addEventListener('error', reject, {once: true}); });
  let id = 0; const pending = new Map(); const errors = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails?.text || 'Runtime exception');
    if (!message.id || !pending.has(message.id)) return;
    const task = pending.get(message.id); pending.delete(message.id);
    message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const messageId = ++id; pending.set(messageId, {resolve, reject}); socket.send(JSON.stringify({id: messageId, method, params}));
  });
  const evaluate = async expression => (await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true})).result?.value;
  const waitExpression = expression => waitFor(() => evaluate(expression));

  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false});
  await send('Page.navigate', {url: `http://127.0.0.1:${serverPort}`});
  await waitExpression(`document.querySelector('#home-home-name')?.textContent === 'Northstar'`);
  await evaluate(`document.querySelector('[data-action="watch"]').click()`);
  assert.equal(await evaluate(`document.querySelector('[data-screen="live"]').classList.contains('active')`), true);
  await evaluate(`document.querySelector('#explain-button').click()`);
  await waitExpression(`document.querySelector('#generation-meta')?.textContent.includes('fallback')`);
  assert.match(await evaluate(`document.querySelector('#replay-summary').textContent`), /Northstar|Maya|run|space/i);
  await evaluate(`document.querySelector('[data-screen="replay"] [data-action="challenge"]').click()`);
  await evaluate(`document.querySelector('[data-action="startChallenge"]').click()`);
  for (let step = 0; step < 12; step += 1) {
    const key = step % 2 ? 'ArrowRight' : 'ArrowLeft';
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'${key}',bubbles:true}))`);
  }
  assert.equal(await evaluate(`document.querySelector('#reps').textContent`), '12');
  await evaluate(`document.querySelector('#camera-button').click()`);
  await waitExpression(`document.querySelector('#camera-button')?.textContent === 'Disable camera'`);
  await evaluate(`document.querySelector('[data-screen="challenge"] [data-action="live"]').click()`);
  await evaluate(`document.querySelector('[data-screen="live"] [data-action="settings"]').click()`);
  assert.equal(await evaluate(`document.querySelector('[data-screen="settings"]').classList.contains('active')`), true);
  assert.match(await evaluate(`document.querySelector('#model-select').textContent`), /Nova|DeepSeek|Loading/);
  const screenshot = await send('Page.captureScreenshot', {format: 'png', captureBeyondViewport: false, fromSurface: true});
  await writeFile('demo/production-simulator.png', Buffer.from(screenshot.data, 'base64'));
  assert.deepEqual(errors, []);
  socket.close();
  console.log('Browser smoke passed: live feed, AI fallback, replay, remote challenge, camera, settings');
} finally {
  server.kill('SIGTERM'); browser?.kill('SIGTERM');
}
