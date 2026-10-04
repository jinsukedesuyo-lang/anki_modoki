// DOM に依存しない小物（Node のテストからも import する）

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function stripHtml(html) {
  return String(html ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .trim();
}

// センテンスは <span class="hl">, <b>, <i>, <br> だけを許可する
export function sanitizeSentence(html) {
  return String(html ?? '')
    .split(/(<[^>]*>)/)
    .map((tok) => {
      const m = tok.match(/^<(\/?)([a-zA-Z0-9]+)([^>]*)>$/);
      if (!m) return tok.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const [, close, rawName, attrs] = m;
      const name = rawName.toLowerCase();
      if (name === 'br') return close ? '' : '<br>';
      if (name === 'b' || name === 'i') return `<${close}${name}>`;
      if (name === 'span') {
        if (close) return '</span>';
        return /class\s*=\s*["']?[^"'>]*\bhl\b/.test(attrs) ? '<span class="hl">' : '<span>';
      }
      if (name === 'div' || name === 'p') return close ? '' : '<br>';
      return '';
    })
    .join('')
    .replace(/^(<br>)+|(<br>)+$/g, '');
}

export function extractWord(sentenceHtml) {
  const m = String(sentenceHtml ?? '').match(/<span class="hl">([\s\S]*?)<\/span>/);
  return m ? stripHtml(m[1]) : '';
}

// プレーンテキストの文中で word の最初の出現を <span class="hl"> で囲んだ HTML を返す
export function highlightWord(text, word) {
  const safe = escapeHtml(text);
  const w = String(word ?? '').trim();
  if (!w) return safe;
  const pattern = escapeHtml(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  // 単語の途中にマッチしないよう前後が英字でない位置を優先し、なければ部分一致
  const strict = new RegExp(`(^|[^A-Za-z])(${pattern})(?![A-Za-z])`, 'i');
  if (strict.test(safe)) return safe.replace(strict, '$1<span class="hl">$2</span>');
  const loose = new RegExp(`(${pattern})`, 'i');
  return loose.test(safe) ? safe.replace(loose, '<span class="hl">$1</span>') : safe;
}

// 長い字幕テキストから word を含む1文だけを取り出す
export function sentenceAround(text, word) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!word || clean.length < 200) return clean;
  const parts = clean.match(/[^.!?。？！]+[.!?。？！]*["'”’)]*\s*/g) || [clean];
  const hit = parts.find((p) => p.toLowerCase().includes(word.toLowerCase()));
  return (hit || clean).trim();
}

// CSV / TSV パーサ（ダブルクォート・改行入りセル対応）
export function parseDelimited(text) {
  const src = String(text ?? '').replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] || '';
  const delim = (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? '\t' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export function uuid() {
  return crypto.randomUUID();
}
