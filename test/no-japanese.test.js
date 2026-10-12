// 英語だけで考えられるよう、画面に出る文字列に日本語が残っていないことを確かめる
// （コメントは開発者向けなので対象外）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const JP = /[぀-ヿ㐀-鿿ｦ-ﾟ]/;

const FILES = [
  'public/index.html',
  'public/manifest.webmanifest',
  'public/js/app.js',
  'public/js/editor.js',
  'public/js/data.js',
  'public/js/srs.js',
  'public/js/practice.js',
  'extension/manifest.json',
  'extension/options.html',
  'extension/background.js',
  'supabase/functions/_shared/gemini.ts',
  'supabase/functions/anki-imagine/index.ts',
];

// コメントを取り除く（行単位の簡易判定。行頭か空白の後の // と、/* */・<!-- --> を消す。
// "https://" のように直前が空白でない // は URL なので残す）
// 行番号を保つため、ブロックコメントは改行だけ残して消す
const blank = (m) => m.replace(/[^\n]/g, '');

for (const file of FILES) {
  test(`${file} に画面に出る日本語がない`, () => {
    const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, blank).replace(/<!--[\s\S]*?-->/g, blank);
    const hits = src
      .split('\n')
      .map((line, n) => [n + 1, line])
      // 入力の判定用パターン（画面には出さない）は「ALLOW_JA」の印で許可
      .filter(([, line]) => !/ALLOW_JA/.test(line))
      .map(([n, line]) => [n, line.replace(/(^|\s)\/\/.*$/, '').trim()])
      .filter(([, line]) => JP.test(line));
    assert.deepEqual(hits, [], `日本語が残っています:\n${hits.map(([n, l]) => `  ${n}: ${l}`).join('\n')}`);
  });
}
