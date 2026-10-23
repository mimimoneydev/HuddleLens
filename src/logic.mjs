export const plays = [
  { minute: 32, team: 'Northstar', event: 'GOAL', score: '1—0', x: 82, y: 43, impact: 78, title: 'The run nobody tracked', summary: 'Maya dragged the fullback wide. That opened a 7-metre passing lane for Imani to attack.', cue: 'Watch the teal runner create space before the pass.', challenge: 'Quick Feet', target: 12 },
  { minute: 38, team: 'Harbor', event: 'SAVE', score: '1—0', x: 18, y: 51, impact: 61, title: 'A brave narrow block', summary: 'The keeper stepped forward early, shrinking the visible goal by nearly half.', cue: 'Notice how the keeper sets before the shot.', challenge: 'Goalie Reach', target: 8 },
  { minute: 44, team: 'Northstar', event: 'CHANCE', score: '1—0', x: 67, y: 28, impact: 48, title: 'One pass too many', summary: 'A first-time shot was available. The extra touch let Harbor reset its defensive line.', cue: 'Pause on the first touch—the far corner is open.', challenge: 'Balance Hold', target: 10 }
];

export function moveFocus(index, direction, count) {
  if (!count) return 0;
  if (direction === 'ArrowRight' || direction === 'ArrowDown') return (index + 1) % count;
  if (direction === 'ArrowLeft' || direction === 'ArrowUp') return (index - 1 + count) % count;
  return index;
}

export function scoreMotion(samples, target) {
  const valid = samples.filter(value => Number.isFinite(value) && value >= 0);
  const effort = valid.reduce((sum, value) => sum + Math.min(value, 2), 0);
  return Math.min(100, Math.round((effort / Math.max(1, target)) * 100));
}

export function accessibilityLabel(level) {
  return ['Rookie · plain language', 'Fan · key tactics', 'Coach · advanced detail'][Math.max(0, Math.min(2, level))];
}

export function formatPrice(perMillion) {
  if (perMillion === null || perMillion === undefined || !Number.isFinite(Number(perMillion))) return 'Unavailable';
  const value = Number(perMillion);
  if (value === 0) return 'Free';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}

export function formatContext(tokens) {
  const value = Number(tokens) || 0;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 ? 1 : 0)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value || '—');
}

export function eventImpact(event) {
  if (Number.isFinite(Number(event?.impact))) return Math.max(0, Math.min(100, Math.round(Number(event.impact))));
  const weights = {Goal: 92, 'Missed Penalty': 88, Card: 70, subst: 35, Var: 75, SAVE: 68, CHANCE: 55};
  return weights[event?.type] || weights[String(event?.type || '').toUpperCase()] || 48;
}

export function selectKeyEvent(events = []) {
  return [...events].sort((a, b) => {
    const minuteDelta = (Number(b.minute) || 0) - (Number(a.minute) || 0);
    return minuteDelta || eventImpact(b) - eventImpact(a);
  })[0] || null;
}

export function detectMotionDirection(previous, current, width, threshold = 26) {
  if (!previous || !current || previous.length !== current.length || !width) return null;
  let left = 0; let right = 0; let changed = 0;
  const half = width / 2;
  for (let index = 0; index < current.length; index += 4) {
    const delta = Math.abs(current[index] - previous[index]) + Math.abs(current[index + 1] - previous[index + 1]) + Math.abs(current[index + 2] - previous[index + 2]);
    if (delta < threshold * 3) continue;
    changed += 1;
    if (((index / 4) % width) < half) left += 1; else right += 1;
  }
  if (changed < Math.max(18, current.length / 4 * 0.018)) return null;
  const dominance = Math.abs(left - right) / Math.max(1, changed);
  if (dominance < 0.12) return null;
  return left > right ? 'ArrowLeft' : 'ArrowRight';
}

export function sanitizeEvent(event) {
  if (!event || typeof event !== 'object') return null;
  return {
    id: String(event.id || ''), sport: String(event.sport || 'football'), minute: Number(event.minute) || 0,
    team: String(event.team || ''), player: String(event.player || ''), type: String(event.type || 'Event'),
    detail: String(event.detail || ''), comments: String(event.comments || ''),
    x: Number.isFinite(Number(event.x)) ? Number(event.x) : null,
    y: Number.isFinite(Number(event.y)) ? Number(event.y) : null,
    impact: eventImpact(event), challenge: String(event.challenge || ''), target: Number(event.target) || 12,
    updatedAt: event.updatedAt || Date.now(),
  };
}
