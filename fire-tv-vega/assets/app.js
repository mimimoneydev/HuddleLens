import {
  moveFocus, accessibilityLabel, formatPrice, formatContext, selectKeyEvent,
  detectMotionDirection, sanitizeEvent, eventImpact,
} from './logic.mjs';

const DEFAULT_BEDROCK_MODEL = 'global.amazon.nova-2-lite-v1:0';
const DEFAULT_OPENROUTER_MODEL = 'deepseek/deepseek-v4.1-flash-1017';
const API_BASE = window.HUDDLELENS_CONFIG?.apiBaseUrl || (location.protocol === 'file:' ? (localStorage.getItem('huddlelens.apiBase') || 'http://10.0.2.2:4173') : '');
const screens = [...document.querySelectorAll('.screen')];
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const state = {
  focusIndex: 0, screen: 'home', detailLevel: Number(localStorage.getItem('huddlelens.detailLevel')) || 0,
  challengeRunning: false, reps: 0, lastDirection: '', cameraEnabled: false, cameraStream: null,
  motionFrame: null, motionTimer: null, lastMotionAt: 0, match: null, events: [], selectedEvent: null,
  modelsByProvider: {bedrock: [], openrouter: []},
  selectedProvider: localStorage.getItem('huddlelens.provider') || null,
  selectedModels: {
    bedrock: localStorage.getItem('huddlelens.model.bedrock') || DEFAULT_BEDROCK_MODEL,
    openrouter: localStorage.getItem('huddlelens.model.openrouter') || localStorage.getItem('huddlelens.model') || DEFAULT_OPENROUTER_MODEL,
  },
  config: null, eventSource: null,
  preferences: JSON.parse(localStorage.getItem('huddlelens.preferences') || '{"captions":true,"spatialAudio":true,"calmCommentary":false,"highContrast":true}'),
};

function controls() { return [...$(`[data-screen="${state.screen}"]`).querySelectorAll('.focusable:not([disabled])')]; }
function focusCurrent() {
  const items = controls(); if (!items.length) return;
  state.focusIndex = Math.min(state.focusIndex, items.length - 1);
  items[state.focusIndex].focus({preventScroll: true});
}
function showScreen(name) {
  if (state.screen === 'challenge' && name !== 'challenge') stopCamera();
  state.screen = name; screens.forEach(screen => screen.classList.toggle('active', screen.dataset.screen === name));
  state.focusIndex = 0; requestAnimationFrame(focusCurrent);
}
function toast(message) {
  const node = $('#toast'); node.textContent = message; node.classList.add('visible');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove('visible'), 2600);
}
function setHealth(id, healthy, text) {
  const label = $(`#${id}`); const dot = $(`#${id}-dot`);
  if (label) label.textContent = text;
  if (dot) dot.classList.toggle('error', !healthy);
}
function formatMinute(match) { return match?.status === 'LIVE' ? `${match.minute || 0}′` : (match?.status || '—'); }

function renderMatch() {
  const match = state.match; if (!match) return;
  const fields = {
    '#home-league': match.league, '#home-home-name': match.home, '#home-away-name': match.away,
    '#home-home-crest': match.homeCode?.[0], '#home-away-crest': match.awayCode?.[0],
    '#home-home-score': match.homeScore, '#home-away-score': match.awayScore, '#home-minute': formatMinute(match),
    '#live-home-code': match.homeCode, '#live-away-code': match.awayCode, '#live-home-score': match.homeScore,
    '#live-away-score': match.awayScore, '#live-minute': formatMinute(match), '#live-state': match.status,
    '#home-live-label': `${match.status} · ${formatMinute(match)}`,
  };
  for (const [selector, value] of Object.entries(fields)) { const node = $(selector); if (node) node.textContent = value ?? '—'; }
  $('#match-progress').style.width = `${Math.min(100, Math.max(2, (Number(match.minute) || 0) / 90 * 100))}%`;
  $('#moment-count').textContent = `${state.events.length} ${state.events.length === 1 ? 'moment' : 'moments'}`;
  $('#home-status').classList.toggle('offline', !state.config?.sports?.connected);
  $('#home-status span').textContent = `${state.config?.sports?.provider || 'live'} · ${state.config?.sports?.connected ? 'connected' : 'reconnecting'}`;
}

function renderEvents() {
  state.selectedEvent = selectKeyEvent(state.events);
  const event = state.selectedEvent;
  const explainButton = $('#explain-button'); explainButton.disabled = !event;
  if (event) {
    $('#event-type').textContent = `${event.type.toUpperCase()} · ${event.minute}′`;
    $('#event-title').textContent = event.detail || `${event.player || event.team} · ${event.type}`;
    $('#event-summary').textContent = event.comments || `${event.player || event.team} was involved in the latest live event.`;
    $('#event-impact').textContent = eventImpact(event);
    $('#live-caption').textContent = `${event.minute}′ · ${event.team}${event.player ? ` · ${event.player}` : ''} · ${event.detail || event.type}`;
  }
  $('#event-rail').innerHTML = state.events.slice(-3).reverse().map(item =>
    `<button class="event-chip focusable" data-event-id="${item.id}"><b>${item.minute}′</b><span>${escapeHtml(item.detail || item.type)}</span></button>`
  ).join('');
  $('#moment-count').textContent = `${state.events.length} ${state.events.length === 1 ? 'moment' : 'moments'}`;
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
}

async function loadConfig() {
  try {
    const response = await fetch(`${API_BASE}/api/config`, {cache: 'no-store'});
    if (!response.ok) throw new Error(`Server returned ${response.status}`);
    state.config = await response.json();
    setHealth('data-health', state.config.sports.connected, `${state.config.sports.provider} · ${state.config.sports.connected ? 'connected' : 'degraded'}`);
    state.selectedProvider ||= state.config.ai?.defaultProvider || 'auto';
    $('#provider-select').value = state.selectedProvider;
    const bedrockStatus = state.config.ai?.bedrock || {};
    const openrouterStatus = state.config.ai?.openrouter || {};
    setHealth('bedrock-health', !bedrockStatus.lastError, bedrockStatus.lastError ? 'Unavailable · failover active' : `Primary · ${bedrockStatus.region || 'AWS IAM'}`);
    setHealth('openrouter-health', openrouterStatus.configured, openrouterStatus.configured ? 'Alternative · configured' : 'API key missing · local fallback');
    $('#provider-name').textContent = state.config.sports.provider;
    $('#provider-detail').textContent = state.config.streamUrl ? 'Licensed live video and event feed configured.' : 'Event feed active. Configure LICENSED_STREAM_URL to show licensed video.';
    configureVideo(state.config.streamUrl);
  } catch (error) {
    state.config = {sports: {provider: 'offline', connected: false, lastError: error.message}, ai: {defaultProvider: 'auto', bedrock: {defaultModel: DEFAULT_BEDROCK_MODEL}, openrouter: {configured: false}}, streamUrl: ''};
    state.selectedProvider ||= 'auto'; $('#provider-select').value = state.selectedProvider;
    setHealth('data-health', false, 'Server unavailable'); setHealth('bedrock-health', false, 'Server unavailable'); setHealth('openrouter-health', false, 'Server unavailable');
    $('#home-status').classList.add('offline'); $('#home-status span').textContent = 'Server offline';
  }
}

async function loadInitialMatch() {
  try {
    const response = await fetch(`${API_BASE}/api/match`, {cache: 'no-store'});
    if (!response.ok) throw new Error('Match feed unavailable');
    applySnapshot(await response.json());
  } catch (error) { toast(error.message); }
}

function applySnapshot(payload) {
  const previousCount = state.events.length;
  state.match = payload.match;
  state.events = (payload.events || []).map(sanitizeEvent).filter(Boolean);
  renderMatch(); renderEvents();
  if (state.events.length > previousCount && state.preferences.spatialAudio) playSpatialCue(state.events.at(-1));
}

function connectEvents() {
  state.eventSource?.close();
  if (!('EventSource' in window)) return;
  const source = new EventSource(`${API_BASE}/api/events/stream`); state.eventSource = source;
  source.addEventListener('snapshot', event => {
    applySnapshot(JSON.parse(event.data));
    setHealth('data-health', true, `${state.config?.sports?.provider || 'feed'} · connected`);
  });
  source.addEventListener('error', () => setHealth('data-health', false, 'Reconnecting…'));
}

function configureVideo(url) {
  const video = $('#live-video'); const fallback = $('#pitch-visual');
  if (!url) { video.removeAttribute('src'); video.classList.remove('ready'); fallback.classList.remove('hidden'); return; }
  video.src = url;
  video.addEventListener('canplay', () => { video.classList.add('ready'); fallback.classList.add('hidden'); }, {once: true});
  video.addEventListener('error', () => { video.classList.remove('ready'); fallback.classList.remove('hidden'); toast('Live video unavailable · event visualization remains active'); });
  video.play().catch(() => {});
}

function playSpatialCue(event) {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext; if (!AudioContext) return;
    playSpatialCue.context ||= new AudioContext();
    const context = playSpatialCue.context; const oscillator = context.createOscillator(); const gain = context.createGain();
    const panner = context.createStereoPanner ? context.createStereoPanner() : null;
    oscillator.frequency.value = eventImpact(event) > 80 ? 660 : 440; gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.03); gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.28);
    if (panner) { panner.pan.value = Number.isFinite(event.x) ? Math.max(-1, Math.min(1, (event.x - 50) / 50)) : 0; oscillator.connect(gain).connect(panner).connect(context.destination); }
    else oscillator.connect(gain).connect(context.destination);
    oscillator.start(); oscillator.stop(context.currentTime + 0.3);
  } catch { /* Audio cues are progressive enhancement. */ }
}

async function loadModels(force = false) {
  const select = $('#model-select'); select.disabled = true; select.innerHTML = '<option>Loading AI models…</option>';
  try {
    const response = await fetch(`${API_BASE}/api/models${force ? '?refresh=1' : ''}`, {cache: 'no-store'});
    const payload = await response.json(); if (!response.ok) throw new Error(payload.error || 'Catalog unavailable');
    for (const provider of payload.providers || []) {
      state.modelsByProvider[provider.id] = provider.models || [];
      if (!state.modelsByProvider[provider.id].some(model => model.id === state.selectedModels[provider.id])) {
        state.selectedModels[provider.id] = provider.defaultModel;
      }
      if (provider.id === 'openrouter') setHealth('openrouter-health', provider.status?.configured && !provider.error, provider.error ? 'Catalog unavailable · fallback ready' : (provider.status?.configured ? 'Alternative · connected' : 'API key missing · local fallback'));
    }
    renderModelOptions();
    if (force) toast(`AI catalogs refreshed`);
  } catch (error) {
    state.modelsByProvider.bedrock = [{id: state.selectedModels.bedrock, name: 'Amazon Nova 2 Lite', inputPricePerMillion: null, outputPricePerMillion: null, contextLength: 1_000_000}];
    state.modelsByProvider.openrouter = [{id: state.selectedModels.openrouter, name: 'DeepSeek V4.1 Flash 1017', inputPricePerMillion: null, outputPricePerMillion: null, contextLength: 0}];
    renderModelOptions(); setHealth('openrouter-health', false, 'Catalog unavailable'); toast(error.message);
  }
}

function activeModelProvider() { return state.selectedProvider === 'openrouter' ? 'openrouter' : 'bedrock'; }

function renderModelOptions() {
  const provider = activeModelProvider();
  const models = state.modelsByProvider[provider] || [];
  const select = $('#model-select');
  if (!models.some(model => model.id === state.selectedModels[provider])) state.selectedModels[provider] = models[0]?.id || (provider === 'bedrock' ? DEFAULT_BEDROCK_MODEL : DEFAULT_OPENROUTER_MODEL);
  select.innerHTML = models.map(model => `<option value="${escapeHtml(model.id)}">${escapeHtml(model.name)}</option>`).join('') || '<option>No models available</option>';
  select.value = state.selectedModels[provider]; select.disabled = !models.length;
  renderModelPrice();
}

function renderModelPrice() {
  const provider = activeModelProvider();
  const models = state.modelsByProvider[provider] || [];
  const model = models.find(item => item.id === state.selectedModels[provider]) || models[0]; if (!model) return;
  $('#input-price').textContent = formatPrice(model.inputPricePerMillion);
  $('#output-price').textContent = formatPrice(model.outputPricePerMillion);
  $('#context-length').textContent = formatContext(model.contextLength);
  $('#model-description').textContent = `${model.name} · ${model.id}`;
  const route = state.selectedProvider === 'auto' ? 'Auto · Bedrock primary' : (provider === 'bedrock' ? 'Amazon Bedrock only' : 'OpenRouter only');
  $('#ai-provider-label').textContent = `${route} · ${model.name}`;
}

async function generateExplanation() {
  const event = state.selectedEvent; if (!event) { toast('No live event is available yet'); return; }
  showScreen('replay');
  $('#ai-loading').classList.add('visible');
  $('#replay-event-label').textContent = `AI LENS · ${event.type.toUpperCase()} · ${event.minute}′`;
  $('#replay-impact').textContent = eventImpact(event); $('#freeze-label').textContent = `${event.minute}′ · FREEZE FRAME`;
  $('#replay-title').textContent = event.detail || event.type; $('#replay-summary').textContent = 'Generating a grounded explanation from the live event…';
  try {
    const response = await fetch(`${API_BASE}/api/explain`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({event, level: ['rookie', 'fan', 'coach'][state.detailLevel], provider: state.selectedProvider, models: state.selectedModels}),
    });
    const explanation = await response.json(); if (!response.ok && !explanation.summary) throw new Error(explanation.error || 'Explanation failed');
    $('#replay-title').textContent = explanation.title; $('#replay-summary').textContent = explanation.summary;
    $('#watch-cue').textContent = explanation.watchCue; $('#challenge-copy').textContent = explanation.challenge;
    $('#challenge-instruction').textContent = `${explanation.challenge} Camera frames stay on this device.`;
    $('#tactical-steps').innerHTML = (explanation.tacticalSteps || []).map(step => `<li>${escapeHtml(step)}</li>`).join('');
    const tokens = explanation.usage?.total_tokens ? ` · ${explanation.usage.total_tokens} tokens` : '';
    const source = explanation.provider === 'bedrock' ? 'Amazon Bedrock' : explanation.provider === 'openrouter' ? 'OpenRouter' : 'Resilient local fallback';
    const failover = explanation.requestedProvider === 'auto' && explanation.provider === 'openrouter' ? ' · automatic failover' : '';
    $('#generation-meta').textContent = `${source}${failover} · ${explanation.model || 'deterministic local model'}${tokens}`;
  } catch (error) { $('#replay-summary').textContent = error.message; $('#generation-meta').textContent = 'Generation unavailable'; }
  finally { $('#ai-loading').classList.remove('visible'); }
}

function setDetailLevel(next = (state.detailLevel + 1) % 3) {
  state.detailLevel = next; localStorage.setItem('huddlelens.detailLevel', String(next));
  $('#level-button').textContent = `Detail: ${['Rookie', 'Fan', 'Coach'][next]}`;
  $('#level-label').textContent = accessibilityLabel(next); toast(`Explanation set to ${accessibilityLabel(next)}`);
}

function countMove(direction, source = 'remote') {
  if (!state.challengeRunning || !['ArrowLeft', 'ArrowRight'].includes(direction) || direction === state.lastDirection) return false;
  state.lastDirection = direction; state.reps += 1; $('#reps').textContent = state.reps;
  const runner = $('#runner'); runner.classList.toggle('step-right', direction === 'ArrowRight'); runner.classList.toggle('step-left', direction === 'ArrowLeft');
  const target = Number($('#rep-target').textContent) || 12;
  $('#encouragement').textContent = state.reps < target / 2 ? `Great ${source === 'camera' ? 'movement' : 'rhythm'}—keep alternating!` : state.reps < target ? 'Halfway! The whole room is moving.' : 'Huddle complete! +120 family points';
  if (state.reps >= target) { state.challengeRunning = false; $('[data-action="startChallenge"]').textContent = 'Play again'; toast('Challenge complete · +120 family points'); }
  return true;
}

function startChallenge(button) {
  state.challengeRunning = !state.challengeRunning; state.reps = 0; state.lastDirection = ''; $('#reps').textContent = '0';
  button.textContent = state.challengeRunning ? 'Challenge active · move!' : 'Start challenge';
  $('#encouragement').textContent = state.challengeRunning ? (state.cameraEnabled ? 'Move side to side—camera scoring is local.' : 'Alternate ◀ and ▶—you’ve got this!') : 'Ready when you are, team.';
}

async function toggleCamera() {
  if (state.cameraEnabled) { stopCamera(); return; }
  if (!navigator.mediaDevices?.getUserMedia) { toast('Camera capture is unavailable on this device'); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: 'user', width: {ideal: 640}, height: {ideal: 360}}, audio: false});
    state.cameraStream = stream; state.cameraEnabled = true; $('#camera-preview').srcObject = stream; $('#camera-preview').classList.add('active');
    $('#runner').classList.add('camera-active'); $('#camera-button').textContent = 'Disable camera'; $('#motion-mode').textContent = 'ON-DEVICE CAMERA';
    $('#motion-hint').textContent = 'Frames never leave this TV'; $('#camera-privacy').textContent = 'LOCAL PROCESSING · ZERO FRAME UPLOADS';
    $('#camera-privacy').classList.add('active'); state.motionFrame = null; scanMotion(); toast('Private on-device camera scoring enabled');
  } catch (error) { toast(error.name === 'NotAllowedError' ? 'Camera permission was not granted' : 'Camera could not be started'); }
}

function scanMotion() {
  if (!state.cameraEnabled) return;
  const video = $('#camera-preview'); const canvas = $('#motion-canvas'); const context = canvas.getContext('2d', {willReadFrequently: true});
  if (video.readyState >= 2) {
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const frame = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const direction = detectMotionDirection(state.motionFrame, frame, canvas.width);
    if (direction && performance.now() - state.lastMotionAt > 350 && countMove(direction, 'camera')) state.lastMotionAt = performance.now();
    state.motionFrame = new Uint8ClampedArray(frame);
  }
  state.motionTimer = requestAnimationFrame(scanMotion);
}

function stopCamera() {
  cancelAnimationFrame(state.motionTimer); state.cameraStream?.getTracks().forEach(track => track.stop());
  state.cameraStream = null; state.cameraEnabled = false; state.motionFrame = null; $('#camera-preview').srcObject = null; $('#camera-preview').classList.remove('active');
  $('#runner').classList.remove('camera-active'); $('#camera-button').textContent = 'Enable camera'; $('#motion-mode').textContent = 'REMOTE MOTION';
  $('#motion-hint').textContent = 'Press ◀ ▶ quickly'; $('#camera-privacy').textContent = 'CAMERA OFF · NO FRAMES CAPTURED'; $('#camera-privacy').classList.remove('active');
}

function applyPreferences() {
  for (const button of $$('.setting[data-setting]')) button.classList.toggle('active-setting', Boolean(state.preferences[button.dataset.setting]));
  document.body.classList.toggle('high-contrast', Boolean(state.preferences.highContrast));
  $('#live-caption').classList.toggle('disabled', !state.preferences.captions);
  $('#live-video').volume = state.preferences.calmCommentary ? 0.55 : 1;
}

function togglePreference(element) {
  const key = element.dataset.setting; state.preferences[key] = !state.preferences[key];
  localStorage.setItem('huddlelens.preferences', JSON.stringify(state.preferences)); applyPreferences();
  toast(`${element.querySelector('b').textContent} ${state.preferences[key] ? 'on' : 'off'}`);
}

async function activate(action, element) {
  const routes = {watch: 'live', home: 'home', live: 'live', challenge: 'challenge', access: 'access', settings: 'settings'};
  if (routes[action]) { showScreen(routes[action]); return; }
  if (action === 'explain') { await generateExplanation(); return; }
  if (action === 'animate') { $('#tactics-board').classList.remove('playing'); requestAnimationFrame(() => $('#tactics-board').classList.add('playing')); toast('Replaying the movement path'); return; }
  if (action === 'level') { setDetailLevel(); await generateExplanation(); return; }
  if (action === 'toggle') { togglePreference(element); return; }
  if (action === 'startChallenge') { startChallenge(element); return; }
  if (action === 'camera') { await toggleCamera(); return; }
  if (action === 'refreshModels') { await loadModels(true); return; }
  if (action === 'resetSettings') {
    state.selectedProvider = state.config?.ai?.defaultProvider || 'auto';
    state.selectedModels.bedrock = state.config?.ai?.bedrock?.defaultModel || DEFAULT_BEDROCK_MODEL;
    state.selectedModels.openrouter = state.config?.ai?.openrouter?.defaultModel || DEFAULT_OPENROUTER_MODEL;
    for (const key of ['huddlelens.provider', 'huddlelens.model', 'huddlelens.model.bedrock', 'huddlelens.model.openrouter']) localStorage.removeItem(key);
    $('#provider-select').value = state.selectedProvider; renderModelOptions(); setDetailLevel(0); toast('Defaults restored');
  }
}

document.addEventListener('click', event => {
  const eventChip = event.target.closest('[data-event-id]');
  if (eventChip) { state.selectedEvent = state.events.find(item => item.id === eventChip.dataset.eventId) || state.selectedEvent; generateExplanation(); return; }
  const target = event.target.closest('[data-action]'); if (target) activate(target.dataset.action, target);
});
$('#provider-select').addEventListener('change', event => {
  state.selectedProvider = event.target.value; localStorage.setItem('huddlelens.provider', state.selectedProvider);
  renderModelOptions(); toast('AI routing saved');
});
$('#model-select').addEventListener('change', event => {
  const provider = activeModelProvider(); state.selectedModels[provider] = event.target.value;
  localStorage.setItem(`huddlelens.model.${provider}`, state.selectedModels[provider]); renderModelPrice(); toast('AI model saved');
});
document.addEventListener('keydown', event => {
  if (state.screen === 'challenge' && countMove(event.key)) { event.preventDefault(); return; }
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    if (document.activeElement?.tagName === 'SELECT') return;
    event.preventDefault(); state.focusIndex = moveFocus(state.focusIndex, event.key, controls().length); focusCurrent();
  } else if (event.key === 'Enter') {
    const target = document.activeElement.closest?.('[data-action]'); if (target && target.tagName !== 'SELECT') { event.preventDefault(); activate(target.dataset.action, target); }
  } else if (event.key === 'Escape' || event.key === 'Backspace') {
    event.preventDefault(); showScreen(['replay', 'challenge', 'access', 'settings'].includes(state.screen) ? 'live' : 'home');
  }
});
window.addEventListener('beforeunload', () => { state.eventSource?.close(); stopCamera(); });

setDetailLevel(state.detailLevel); applyPreferences(); focusCurrent();
await loadConfig(); await Promise.all([loadInitialMatch(), loadModels()]); connectEvents();
