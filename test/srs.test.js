import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answer, newSrs, dayStart, DEFAULT_SETTINGS as S } from '../public/js/srs.js';

const MIN = 60_000;
const DAY = 86_400_000;
const t0 = new Date(2026, 9, 4, 12, 0).getTime(); // ローカル時刻 12:00

test('新規 → Good を学習ステップ分押すと卒業して1日後', () => {
  let s = newSrs();
  s = answer('a', s, 'good', t0);
  assert.equal(s.state, 'learning');
  assert.equal(s.due, t0 + 10 * MIN);
  s = answer('a', s, 'good', t0 + 10 * MIN);
  assert.equal(s.state, 'review');
  assert.equal(s.interval, 1);
  assert.equal(s.due, dayStart(t0) + DAY);
});

test('学習中の Again は最初のステップに戻る', () => {
  let s = answer('a', newSrs(), 'good', t0);
  s = answer('a', s, 'again', t0 + MIN);
  assert.equal(s.state, 'learning');
  assert.equal(s.step, 0);
  assert.equal(s.due, t0 + 2 * MIN);
});

test('復習の Good は間隔 × ease で伸びる', () => {
  const s = { ...newSrs(), state: 'review', interval: 10, due: t0, reps: 5 };
  const next = answer('card-x', s, 'good', t0);
  // 10 * 2.5 = 25 に ±5% のファズ
  assert.ok(next.interval >= 24 && next.interval <= 26, `interval=${next.interval}`);
  assert.equal(next.due, dayStart(t0) + next.interval * DAY);
});

test('ファズは同じカード・同じ回数なら決定的（オフライン再送で結果がずれない）', () => {
  const s = { ...newSrs(), state: 'review', interval: 30, due: t0, reps: 7 };
  assert.deepEqual(answer('id1', s, 'good', t0), answer('id1', s, 'good', t0));
});

test('復習の Again は間隔を1にリセットし、ease を下げて再学習へ', () => {
  const s = { ...newSrs(), state: 'review', interval: 40, due: t0, reps: 6, ease: 2.5 };
  const next = answer('a', s, 'again', t0);
  assert.equal(next.state, 'relearning');
  assert.equal(next.interval, 1);
  assert.equal(next.lapses, 1);
  assert.equal(next.ease, 2.3);
  assert.equal(next.due, t0 + 10 * MIN);
  const back = answer('a', next, 'good', t0 + 10 * MIN);
  assert.equal(back.state, 'review');
  assert.equal(back.interval, 1);
});

test('ease は最小値より下がらない', () => {
  const s = { ...newSrs(), state: 'review', interval: 3, due: t0, ease: 1.35 };
  assert.equal(answer('a', s, 'again', t0).ease, S.minEase);
});

test('遅れて復習した Good は遅延日数の半分を加味する', () => {
  const s = { ...newSrs(), state: 'review', interval: 2, due: dayStart(t0) - 4 * DAY, reps: 1 };
  const next = answer('a', s, 'good', t0);
  // (2 + 4/2) * 2.5 = 10 に ±1日のファズ
  assert.ok(next.interval >= 9 && next.interval <= 11, `interval=${next.interval}`);
});

test('1日の区切りは午前4時', () => {
  const at3 = new Date(2026, 9, 4, 3, 0).getTime();
  assert.equal(dayStart(at3), new Date(2026, 9, 3, 4, 0).getTime());
  assert.equal(dayStart(t0), new Date(2026, 9, 4, 4, 0).getTime());
});
