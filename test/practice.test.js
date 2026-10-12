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
  // 日本語の意味は渡さず、英語の意味が無ければ文脈から判断させる
  assert.match(p, /2\. "sugarcoat" — meaning: judge it from the sentence below/);
  assert.doesNotMatch(p, /オブラート/);
  assert.match(p, /Always use the sense that fits the sentence/);
  assert.match(p, /Never use Japanese/);
  assert.doesNotMatch(p, /<span/);
  assert.match(p, /Mode: role-play/);
  assert.match(p, /Don't say it before I try/);
  assert.match(p, /RESULT: gloss over=◎, sugarcoat=◎, \.\.\./);
});

test('つまずいたときの3つのルールが入る', () => {
  const p = buildPracticePrompt({ cards, mode: 'retrieval' });
  // 1. 「わからない」→ すぐ答える
  assert.match(p, /"I don't understand".*answer IMMEDIATELY/s);
  // 2. 文が作れない → 例文を出してから自分の文を作らせる
  assert.match(p, /Can't make a sentence.*example sentence.*make my own sentence/s);
  // 3. 不自然 → 先に進まず言い直させる
  assert.match(p, /Unnatural sentence.*do NOT move on.*say the better version myself/s);
  // 以前の「答えは聞かれたときだけ」は残っていない
  assert.doesNotMatch(p, /Give the answer only if I ask/);
});

test('語数と進捗の案内（◯個目 / 全◯個）が入る', () => {
  const p = buildPracticePrompt({ cards, mode: 'roleplay' });
  assert.match(p, /TARGET EXPRESSIONS \(2 in total\)/);
  assert.match(p, /PROGRESS/);
  assert.match(p, /We have 2 expressions today/);
  assert.match(p, /number 2 of 2/);
  assert.match(p, /Count in the order we practice/);
});

test('ヒントでも出てこなければ答えを教えて先へ進む（ループしない）', () => {
  assert.match(buildPracticePrompt({ cards, mode: 'retrieval' }), /If I still miss it after the hint, tell me the expression and its meaning, and go on to step \(2\)/);
  assert.match(buildPracticePrompt({ cards, mode: 'questions' }), /If I still miss it after the hint.*ask me to use it in my own sentence/);
});

test('◎△× は「自分の文で使えたか」で判定し、レポートも英語', () => {
  const p = buildPracticePrompt({ cards });
  assert.match(p, /short report in simple English/);
  assert.match(p, /◎ on my own, with no hint or example/);
  assert.match(p, /× never in my own sentence/);
  assert.doesNotMatch(p, /[぀-ヿ一-鿿]/);
});

test('音声モードでも、最後のレポートでは表を使ってよい', () => {
  assert.match(buildPracticePrompt({ cards, voice: true }), /voice-only rules no longer apply here/);
  assert.doesNotMatch(buildPracticePrompt({ cards, voice: false }), /voice-only rules/);
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
