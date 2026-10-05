// 間隔反復スケジューラ（Good / Again の2択専用）
// サーバー（Node）とブラウザ（オフライン復習）の両方から import される。
// 同じ入力に対して必ず同じ結果を返す（ファズは cardId + reps から決定的に計算）。

export const DEFAULT_SETTINGS = {
  newPerDay: 20,
  // 新規カードは Good 1回で卒業させる（Again のときだけ10分後に再出題）
  learningSteps: [10], // 分
  relearningSteps: [10], // 分
  graduatingInterval: 1, // 日
  startingEase: 2.5,
  minEase: 1.3,
  lapseEasePenalty: 0.2,
  maxInterval: 36500, // 日
  dayStartHour: 4, // 1日の区切り（Anki と同じく午前4時）
};

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

export function newSrs(settings = DEFAULT_SETTINGS) {
  return {
    state: 'new', // new | learning | review | relearning
    due: 0,
    interval: 0, // 日
    ease: settings.startingEase,
    reps: 0,
    lapses: 0,
    step: 0,
  };
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

// 同じ日に同じカードが固まらないように ±5% 程度ずらす
function fuzz(interval, seed) {
  if (interval < 3) return interval;
  const range = Math.max(1, Math.round(interval * 0.05));
  return interval + Math.round((hash(seed) * 2 - 1) * range);
}

// ローカル時刻の「その日の始まり」（dayStartHour 基準）
export function dayStart(now, settings = DEFAULT_SETTINGS) {
  const d = new Date(now);
  d.setHours(settings.dayStartHour, 0, 0, 0);
  if (d.getTime() > now) d.setDate(d.getDate() - 1);
  return d.getTime();
}

export function dayEnd(now, settings = DEFAULT_SETTINGS) {
  const d = new Date(dayStart(now, settings));
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

// 復習カードの期日は「n日後の1日の始まり」に揃える
function dueInDays(now, days, settings) {
  const d = new Date(dayStart(now, settings));
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/**
 * @param {string} cardId
 * @param {object} srs 現在の状態
 * @param {'good'|'again'} rating
 * @param {number} now ms
 * @returns {object} 新しい状態
 */
export function answer(cardId, srs, rating, now, settings = DEFAULT_SETTINGS) {
  const s = { ...srs };
  const good = rating === 'good';

  if (s.state === 'new') s.state = 'learning';

  if (s.state === 'learning' || s.state === 'relearning') {
    const steps = s.state === 'learning' ? settings.learningSteps : settings.relearningSteps;
    if (good) {
      s.step += 1;
      if (s.step >= steps.length) {
        if (s.state === 'learning') s.interval = settings.graduatingInterval;
        s.state = 'review';
        s.step = 0;
        s.due = dueInDays(now, s.interval, settings);
      } else {
        s.due = now + steps[s.step] * MIN;
      }
    } else {
      s.step = 0;
      s.due = now + steps[0] * MIN;
    }
  } else if (s.state === 'review') {
    if (good) {
      const daysLate = Math.max(0, Math.floor((dayStart(now, settings) - s.due) / DAY));
      let next = Math.round((s.interval + daysLate / 2) * s.ease);
      next = fuzz(next, `${cardId}:${s.reps}`);
      next = Math.max(s.interval + 1, next);
      s.interval = Math.min(settings.maxInterval, next);
      s.due = dueInDays(now, s.interval, settings);
    } else {
      // 要件: 間隔を完全にリセット（1から）して直近で再出題
      s.lapses += 1;
      s.ease = Math.max(settings.minEase, +(s.ease - settings.lapseEasePenalty).toFixed(2));
      s.interval = 1;
      s.state = 'relearning';
      s.step = 0;
      s.due = now + settings.relearningSteps[0] * MIN;
    }
  }

  s.reps += 1;
  return s;
}

// 次回の間隔を人間向けに表示（ボタンの上に出す）
export function previewLabel(cardId, srs, rating, now, settings = DEFAULT_SETTINGS) {
  const next = answer(cardId, srs, rating, now, settings);
  if (next.state === 'review') {
    const d = next.interval;
    if (d < 30) return `${d}日`;
    if (d < 365) return `${(d / 30).toFixed(1)}ヶ月`;
    return `${(d / 365).toFixed(1)}年`;
  }
  const m = Math.round((next.due - now) / MIN);
  return m < 60 ? `${m}分` : `${Math.round(m / 60)}時間`;
}
