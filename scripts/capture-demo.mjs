import fs from 'node:fs/promises';
import path from 'node:path';

const outputDir = path.resolve('demo/frames');
await fs.mkdir(outputDir, {recursive: true});

const targets = await fetch('http://127.0.0.1:9222/json').then(response => response.json());
const target = targets.find(item => item.type === 'page');
if (!target) throw new Error('No Chrome page target found');

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, {once: true});
  socket.addEventListener('error', reject, {once: true});
});

let id = 0;
const pending = new Map();
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const {resolve, reject} = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});

function send(method, params = {}) {
  const messageId = ++id;
  socket.send(JSON.stringify({id: messageId, method, params}));
  return new Promise((resolve, reject) => pending.set(messageId, {resolve, reject}));
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = expression => send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});

async function shot(name) {
  await pause(350);
  const {data} = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    fromSurface: true,
  });
  await fs.writeFile(path.join(outputDir, `${name}.png`), Buffer.from(data, 'base64'));
  console.log(`Captured ${name}`);
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1920,
  height: 1080,
  deviceScaleFactor: 1,
  mobile: false,
  screenWidth: 1920,
  screenHeight: 1080,
});
await send('Page.navigate', {url: 'http://127.0.0.1:4173'});
await pause(1400);

await shot('01-home');
await evaluate(`document.querySelector('[data-action="watch"]').click()`);
await shot('02-live');
await evaluate(`document.querySelector('[data-screen="live"] [data-action="explain"]').click()`);
await shot('03-ai-lens');
await evaluate(`document.querySelector('[data-action="animate"]').click()`);
await pause(700);
await shot('04-telestration');
await evaluate(`document.querySelector('[data-action="level"]').click(); document.querySelector('[data-action="level"]').click()`);
await shot('05-coach-detail');
await evaluate(`document.querySelector('[data-screen="replay"] [data-action="challenge"]').click()`);
await shot('06-move-break');
await evaluate(`document.querySelector('[data-action="startChallenge"]').click()`);
await shot('07-challenge-start');
for (let step = 0; step < 7; step += 1) {
  const key = step % 2 === 0 ? 'ArrowLeft' : 'ArrowRight';
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', {key: '${key}', bubbles: true}))`);
  await pause(100);
}
await shot('08-challenge-progress');
for (let step = 7; step < 12; step += 1) {
  const key = step % 2 === 0 ? 'ArrowLeft' : 'ArrowRight';
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', {key: '${key}', bubbles: true}))`);
  await pause(100);
}
await shot('09-challenge-complete');
await evaluate(`document.querySelector('[data-screen="challenge"] [data-action="live"]').click()`);
await evaluate(`document.querySelector('[data-screen="live"] [data-action="access"]').click()`);
await shot('10-accessibility');
await evaluate(`document.querySelectorAll('[data-screen="access"] [data-action="toggle"]')[2].click()`);
await shot('11-calm-commentary');
await evaluate(`document.querySelector('[data-screen="access"] [data-action="home"]').click()`);
await shot('12-close');

socket.close();
