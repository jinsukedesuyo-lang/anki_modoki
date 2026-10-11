import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPracticePrompt, MODES } from '../public/js/practice.js';

const cards = [
  {
    word: 'gloss over',
    sentence: 'He tried to <span class="hl">gloss over</span> the mistake.',
    meaning: 'ごまかす',
    source: { title: 'The Office' },
    imagery: { sense_en: 'to avoid talking about a problem', core_image_en: 'polishing a shiny layer over a crack' },
  },
  { word: 'sugarcoat', sentence: "I won't <span class=\"hl\">sugarcoat</span> it.", meaning: 'オブラートに包む', source: null },
];

test('対象の表現・文脈・イメージが入り、HTML タグは残らない', () => {
  const p = buildPracticePrompt({ cards, mode: 'roleplay', level: 'B1' });
  assert.match(p, /1\. "gloss over" — meaning here: to avoid talking about a problem — native image: polishing a shiny layer over a crack — where I met it: "He tried to gloss over the mistake\." \(The Office\)/);
  assert.match(p, /2\. "sugarcoat" — meaning \(Japanese\): オブラートに包む/);
  assert.doesNotMatch(p, /<span/);
  assert.match(p, /Mode: role-play/);
  assert.match(p, /Don't say it before I try/);
  assert.match(p, /RESULT: gloss over=◎, sugarcoat=◎, \.\.\./);
});

test('つまずいたときの3つのルールが入る', () => {
  const p = buildPracticePrompt({ cards, mode: 'retrieval' });
  // 1. 「わからない」→ すぐ答える
  assert.match(p, /"I don't understand".*answer IMMEDIATELY/s);
  assert.match(p, /わからない/);
  // 2. 文が作れない → 例文を出してから自分の文を作らせる
  assert.match(p, /Can't make a sentence.*example sentence.*make my own sentence/s);
  // 3. 不自然 → 先に進まず言い直させる
  assert.match(p, /Unnatural sentence.*do NOT move on.*say the better version myself/s);
  // 以前の「答えは聞かれたときだけ」は残っていない
  assert.doesNotMatch(p, /Give the answer only if I ask/);
});

test('音声会話モードでは記号・表を使わない指示になる', () => {
  const p = buildPracticePrompt({ cards, mode: 'questions', voice: true });
  assert.match(p, /spoken \(voice\) conversation/);
  assert.match(p, /Say "Better:"/);
  assert.doesNotMatch(p, /✔/);
});

test('すべてのモードにラベルと説明がある', () => {
  for (const m of Object.values(MODES)) {
    assert.ok(m.label && m.hint && m.text);
  }
});
