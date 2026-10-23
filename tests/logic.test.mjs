import test from 'node:test';
import assert from 'node:assert/strict';
import {
  moveFocus, scoreMotion, accessibilityLabel, plays, formatPrice, formatContext,
  selectKeyEvent, detectMotionDirection, sanitizeEvent,
} from '../src/logic.mjs';

test('remote focus wraps in both directions', () => {
  assert.equal(moveFocus(2, 'ArrowRight', 3), 0);
  assert.equal(moveFocus(0, 'ArrowLeft', 3), 2);
  assert.equal(moveFocus(1, 'Enter', 3), 1);
});

test('motion scoring ignores invalid values and caps at 100', () => {
  assert.equal(scoreMotion([1, 1, Number.NaN, -3], 4), 50);
  assert.equal(scoreMotion([2, 2, 2], 2), 100);
});

test('detail level is clamped and all plays have a challenge', () => {
  assert.equal(accessibilityLabel(-1), 'Rookie · plain language');
  assert.equal(accessibilityLabel(9), 'Coach · advanced detail');
  assert.ok(plays.every(play => play.title && play.summary && play.target > 0));
});

test('model price and context values are presentation safe', () => {
  assert.equal(formatPrice(0.0004), '$0.0004');
  assert.equal(formatPrice(0.2), '$0.200');
  assert.equal(formatPrice(2), '$2.00');
  assert.equal(formatPrice(null), 'Unavailable');
  assert.equal(formatContext(128000), '128K');
  assert.equal(formatContext(1000000), '1M');
});

test('the newest event is selected and untrusted fields are sanitized', () => {
  const selected = selectKeyEvent([{id: 'a', minute: 10, type: 'SAVE'}, {id: 'b', minute: 12, type: 'Goal'}]);
  assert.equal(selected.id, 'b');
  const sanitized = sanitizeEvent({id: 7, minute: '4', type: 'Goal', x: '82'});
  assert.deepEqual({...sanitized, updatedAt: 'checked'}, {
    id: '7', sport: 'football', minute: 4, team: '', player: '', type: 'Goal', detail: '', comments: '',
    x: 82, y: null, impact: 92, challenge: '', target: 12, updatedAt: 'checked',
  });
});

test('camera motion direction is derived without storing an image', () => {
  const width = 20; const pixels = width * 10 * 4;
  const previous = new Uint8ClampedArray(pixels); const leftMotion = new Uint8ClampedArray(pixels);
  for (let pixel = 0; pixel < width * 10; pixel += 1) {
    if (pixel % width < width / 2) leftMotion[pixel * 4] = leftMotion[pixel * 4 + 1] = leftMotion[pixel * 4 + 2] = 255;
  }
  assert.equal(detectMotionDirection(previous, leftMotion, width), 'ArrowLeft');
  assert.equal(detectMotionDirection(previous, previous, width), null);
});
