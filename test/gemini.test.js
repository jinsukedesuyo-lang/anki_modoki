import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCost,
  extractText,
  extractImage,
  parseJsonText,
  imageryPrompt,
  imageRequest,
  imageryRequest,
} from '../supabase/functions/_shared/gemini.ts';

test('画像リクエストには「文字なし」の一文が必ず付く', () => {
  const r = imageRequest('m', 'A hand pours liquid into a clay figure.  ');
  assert.match(r.input[0].text, /^A hand pours liquid into a clay figure\. Absolutely no text/);
  assert.equal(r.response_format.type, 'image');
});

test('分析リクエスト: JSON 出力の指定と、スクショがあれば画像を添付', () => {
  const r = imageryRequest('m', 'low', { sentence: 's', word: 'w' }, { data: 'AAA' });
  assert.deepEqual(r.response_format.type, 'text');
  assert.equal(r.response_format.mime_type, 'application/json');
  assert.equal(r.input.length, 2);
  assert.match(r.input[0].text, /only to understand which sense/);
  assert.equal(imageryRequest('m', 'low', { sentence: 's', word: 'w' }, null).input.length, 1);
});

const TEXT = { input: 0.3, output: 2.5 };
const IMAGE = { input: 0.25, output: 1.5, imageOutput: 30 };

test('テキスト呼び出しの料金: 入力 + (出力 + 思考) × 出力単価', () => {
  const c = computeCost({ total_input_tokens: 1000, total_output_tokens: 300, total_thought_tokens: 200 }, TEXT);
  // 1000×0.3 + 500×2.5 = 300 + 1250 = 1550 / 1e6
  assert.equal(c.cost_usd, 0.00155);
  assert.equal(c.thought_tokens, 200);
  assert.equal(c.image_tokens, 0);
});

test('画像呼び出しの料金: 画像トークンは画像単価で数える', () => {
  const c = computeCost(
    {
      total_input_tokens: 100,
      total_output_tokens: 1130,
      output_tokens_by_modality: [
        { modality: 'image', tokens: 1120 },
        { modality: 'text', tokens: 10 },
      ],
    },
    IMAGE,
    true,
  );
  // 100×0.25 + 10×1.5 + 1120×30 = 25 + 15 + 33600 = 33640 / 1e6
  assert.equal(c.cost_usd, 0.03364);
  assert.equal(c.image_tokens, 1120);
});

test('画像を返したのに内訳がない場合は出力を全て画像として数える（過小評価しない）', () => {
  const c = computeCost({ total_input_tokens: 100, total_output_tokens: 1120 }, IMAGE, true);
  assert.equal(c.image_tokens, 1120);
  assert.equal(c.cost_usd, 0.033625);
});

test('usage が無いときは 0 円', () => {
  assert.equal(computeCost(undefined, TEXT).cost_usd, 0);
});

test('応答の読み取り: steps[].content のテキストと画像', () => {
  const json = {
    steps: [
      { type: 'user_input', content: [{ type: 'text', text: 'ignored' }] },
      { type: 'model_output', content: [{ type: 'text', text: '{"a":' }, { type: 'text', text: '1}' }, { type: 'image', data: 'AAA', mime_type: 'image/png' }] },
    ],
  };
  assert.equal(extractText(json), '{"a":1}');
  assert.deepEqual(extractImage(json), { data: 'AAA', mime_type: 'image/png' });
});

test('応答の読み取り: output_image / outputs 形式にも対応', () => {
  assert.deepEqual(extractImage({ output_image: { data: 'BBB', mime_type: 'image/jpeg' } }), { data: 'BBB', mime_type: 'image/jpeg' });
  assert.deepEqual(extractImage({ outputs: [{ type: 'image', data: 'CCC' }] }), { data: 'CCC', mime_type: 'image/jpeg' });
  assert.equal(extractImage({ steps: [] }), null);
});

test('JSON がコードブロックで返ってきても読める', () => {
  assert.deepEqual(parseJsonText('```json\n{"x": 1}\n```'), { x: 1 });
});

test('プロンプトに文・単語・タイトル・スクショの有無が入る', () => {
  const p = imageryPrompt({ sentence: 'He tried to gloss over it.', word: 'gloss over', title: 'The Office', hasScreenshot: true });
  assert.match(p, /Target expression: "gloss over"/);
  assert.match(p, /Sentence: "He tried to gloss over it\."/);
  assert.match(p, /The Office/);
  assert.match(p, /screenshot/);
});
