import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSentence, extractWord, highlightWord, parseDelimited, sentenceAround, stripHtml } from '../public/js/lib.js';

test('sanitizeSentence はハイライト以外のタグ・属性を除去する', () => {
  assert.equal(
    sanitizeSentence('<span class="hl" style="color:red" onclick="x()">gloss</span> over <img src=x onerror=alert(1)>it'),
    '<span class="hl">gloss</span> over it'
  );
  assert.equal(sanitizeSentence('<script>alert(1)</script>hi'), 'alert(1)hi');
  assert.equal(sanitizeSentence('a < b'), 'a &lt; b');
  assert.equal(sanitizeSentence('<div>line1</div><div>line2</div>'), 'line1<br>line2');
});

test('extractWord は最初のハイライトの中身を返す', () => {
  assert.equal(extractWord('He tried to <span class="hl">gloss over</span> it.'), 'gloss over');
  assert.equal(extractWord('no highlight'), '');
});

test('highlightWord は単語境界を優先して最初の出現を囲む', () => {
  assert.equal(highlightWord('An apple and a nap.', 'nap'), 'An apple and a <span class="hl">nap</span>.');
  assert.equal(highlightWord('Running late', 'running'), '<span class="hl">Running</span> late');
  assert.equal(highlightWord('a <b> c', 'c'), 'a &lt;b&gt; <span class="hl">c</span>');
  assert.equal(highlightWord('He gave up  easily', 'gave up'), 'He <span class="hl">gave up</span>  easily');
  assert.equal(highlightWord('No match here', 'zzz'), 'No match here');
});

test('parseDelimited は CSV のクォート・改行・TSV を扱える', () => {
  assert.deepEqual(parseDelimited('word,sentence\n"run","He said, ""run""\nnow"\n'), [
    ['word', 'sentence'],
    ['run', 'He said, "run"\nnow'],
  ]);
  assert.deepEqual(parseDelimited('﻿a\tb\r\n1\t2'), [['a', 'b'], ['1', '2']]);
});

test('sentenceAround は長いテキストから単語を含む1文を取り出す', () => {
  const long = 'First sentence is here and it is fairly long to exceed the limit. '.repeat(3) +
    'Then he decided to procrastinate again. Last one is also quite long for testing purposes here.';
  assert.equal(sentenceAround(long, 'procrastinate'), 'Then he decided to procrastinate again.');
  assert.equal(sentenceAround('Short one.', 'x'), 'Short one.');
});

test('stripHtml はタグを除いてエンティティを戻す', () => {
  assert.equal(stripHtml('<span class="hl">a</span> &amp; b<br>c'), 'a & b c');
});
