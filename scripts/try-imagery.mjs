// AI イメージ生成のプロンプトを手元で試すスクリプト（本番の Edge Function と同じリクエストを送る）
//
//   node scripts/try-imagery.mjs "as much as we wanted a child to *embody* the love we felt"
//   node scripts/try-imagery.mjs "...*word*..." --image      ← 画像も生成して tmp/ に保存（約5円）
//
// 分析だけなら1回 約0.3円。supabase/functions/.env の GEMINI_API_KEY・モデル・単価を使う。
// アプリを通さないので、AI利用料の画面には記録されない。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import {
  GEMINI_ENDPOINT,
  imageryRequest,
  imageRequest,
  extractText,
  extractImage,
  parseJsonText,
  computeCost,
} from '../supabase/functions/_shared/gemini.ts';

const env = Object.fromEntries(
  readFileSync('supabase/functions/.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^\s*[A-Z_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
if (!env.GEMINI_API_KEY) throw new Error('supabase/functions/.env に GEMINI_API_KEY がありません');

const args = process.argv.slice(2);
const withImage = args.includes('--image');
const raw = args.find((a) => !a.startsWith('--'));
const m = raw && /\*([^*]+)\*/.exec(raw);
if (!m) {
  console.error('使い方: node scripts/try-imagery.mjs "文の中で *単語* を囲む" [--image]');
  process.exit(1);
}
const word = m[1];
const sentence = raw.replace(/\*/g, '');

async function interact(body) {
  const res = await fetch(GEMINI_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({ ...body, store: false }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `HTTP ${res.status}`);
  return json;
}

const textModel = env.ANKI_TEXT_MODEL || 'gemini-3.5-flash-lite';
const concept = await interact(imageryRequest(textModel, env.ANKI_TEXT_THINKING || 'low', { sentence, word }));
const imagery = parseJsonText(extractText(concept));
const c1 = computeCost(concept.usage, { input: +env.ANKI_PRICE_TEXT_INPUT || 0.3, output: +env.ANKI_PRICE_TEXT_OUTPUT || 2.5 });
console.log(JSON.stringify(imagery, null, 2));
console.log(`\n分析: ${c1.input_tokens} in / ${c1.output_tokens + c1.thought_tokens} out → $${c1.cost_usd}`);

if (withImage) {
  const imageModel = env.ANKI_IMAGE_MODEL || 'gemini-3.1-flash-lite-image';
  const out = await interact(imageRequest(imageModel, imagery.image_prompt));
  const img = extractImage(out);
  if (!img) throw new Error('画像が返ってきませんでした');
  const c2 = computeCost(
    out.usage,
    { input: +env.ANKI_PRICE_IMAGE_INPUT || 0.25, output: +env.ANKI_PRICE_IMAGE_OUTPUT_TEXT || 1.5, imageOutput: +env.ANKI_PRICE_IMAGE_OUTPUT_IMAGE || 30 },
    true,
  );
  mkdirSync('tmp', { recursive: true });
  const file = `tmp/${word.replace(/\W+/g, '_')}_${Date.now()}.jpg`;
  writeFileSync(file, Buffer.from(img.data, 'base64'));
  console.log(`画像: ${file} → $${c2.cost_usd}`);
}
