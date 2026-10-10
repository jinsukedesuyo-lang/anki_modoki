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
  assert.match(p, /Never say a target expression before I do/);
  assert.match(p, /RESULT: gloss over=◎, sugarcoat=◎, \.\.\./);
});

test('音声会話モードでは記号・表を使わない指示になる', () => {
  const p = buildPracticePrompt({ cards, mode: 'questions', voice: true });
  assert.match(p, /spoken \(voice\) conversation/);
  assert.match(p, /say "Better:"/);
  assert.doesNotMatch(p, /✔/);
});

test('すべてのモードにラベルと説明がある', () => {
  for (const m of Object.values(MODES)) {
    assert.ok(m.label && m.hint && m.text);
  }
});
