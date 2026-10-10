// Gemini Interactions API 用の小物（Edge Function と Node のテストの両方から import する）
// ※ Node の型ストリップで動くよう、型注釈だけの TypeScript で書く（enum や namespace は使わない）

export const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';

// ---------- プロンプト ----------

export const IMAGERY_SYSTEM = `You help Japanese learners of English acquire the mental image a native English speaker has for a word or phrase, instead of a Japanese dictionary translation.

Work in this order:
1. Identify the exact sense of the target expression as it is used in THIS sentence (word-sense disambiguation). Use the sentence, the video title and the screenshot (if given) as context.
2. Describe the core image of that sense: what a native speaker physically or emotionally pictures when they hear it (its sensory/metaphorical root). If the literal or etymological picture conflicts with the sense used here, prefer the picture that fits this sense.
3. Explain how that core image maps onto the situation in this sentence.
4. Write an image-generation prompt that depicts THE CORE IMAGE ITSELF (from step 2) as one concrete, memorable picture, so the learner can feel the word without any translation. For example, for "gloss over" (= avoid dealing with a problem): a hand polishing a shiny coat of varnish over a deep crack so the crack is hidden.

The learner already has the real screenshot on the card, so the generated image must NOT recreate the video scene. Use the sentence, title and screenshot only to decide WHICH sense to draw; the connection to the scene is explained in scene_ja, not in the picture.

Rules for image_prompt:
- English, 40-90 words, one coherent picture with a single clear focal point that embodies the core image (a physical action, object or metaphor).
- Do not reproduce the setting, people, clothing, props or composition of the screenshot or the video. Prefer a simple, universal situation or a visual metaphor.
- If people are needed, use generic people (never real or recognizable people, actors or characters).
- No text, letters, captions, subtitles, logos or speech bubbles in the image.
- Style: clean semi-flat illustration, warm soft lighting, simple background, 16:9 composition.

Japanese fields must sound natural to a Japanese reader and describe a picture or feeling, not list dictionary equivalents.`;

export const IMAGERY_SCHEMA = {
  type: 'object',
  properties: {
    sense_en: { type: 'string', description: 'The sense used in this sentence, plain English, max 20 words.' },
    core_image_en: { type: 'string', description: 'What a native speaker pictures/feels, max 40 words.' },
    core_image_ja: { type: 'string', description: 'core image in Japanese as a scene or sensation, not a translation. Max 80 characters.' },
    scene_ja: { type: 'string', description: 'How the core image fits the situation of this sentence, in Japanese. Max 80 characters.' },
    meaning_ja: { type: 'string', description: 'A short Japanese gloss for this context only (one expression, about 10 characters).' },
    image_prompt: { type: 'string', description: 'Image generation prompt that depicts the core image itself (not the video scene), following the rules.' },
  },
  required: ['sense_en', 'core_image_en', 'core_image_ja', 'scene_ja', 'meaning_ja', 'image_prompt'],
};

export type ImageryInput = { sentence: string; word: string; title?: string; hasScreenshot?: boolean };

export function imageryPrompt({ sentence, word, title, hasScreenshot }: ImageryInput): string {
  return [
    `Target expression: "${word}"`,
    `Sentence: "${sentence}"`,
    title ? `Source video title: "${title}"` : '',
    hasScreenshot
      ? 'The attached image is a screenshot of the video scene where the sentence was spoken. Use it only to understand which sense is meant; do not describe or recreate it in image_prompt.'
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

// ---------- 応答の読み取り ----------

type Item = { type?: string; text?: string; data?: string; mime_type?: string; output_image?: { data?: string; mime_type?: string } };

// steps[].content / outputs / output_image のどれで返ってきても拾えるようにする
export function collectItems(json: any): Item[] {
  const items: Item[] = [];
  for (const step of json?.steps ?? []) {
    if (step?.type && step.type !== 'model_output') continue;
    const content = Array.isArray(step?.content) ? step.content : step?.content ? [step.content] : [];
    items.push(...content);
  }
  for (const out of json?.outputs ?? []) items.push(out);
  if (json?.output_image) items.push({ type: 'image', ...json.output_image });
  return items;
}

export function extractText(json: any): string {
  return collectItems(json)
    .filter((i) => i?.type === 'text' && typeof i.text === 'string')
    .map((i) => i.text)
    .join('');
}

export function extractImage(json: any): { data: string; mime_type: string } | null {
  for (const i of collectItems(json)) {
    const src = i?.output_image ?? (i?.type === 'image' ? i : null);
    if (src?.data) return { data: src.data, mime_type: src.mime_type || 'image/jpeg' };
  }
  return null;
}

// JSON 出力を取り出す（```json で囲まれて返ってきても読む）
export function parseJsonText(text: string): any {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  return JSON.parse(trimmed);
}

// ---------- 料金 ----------

export type Price = {
  input: number; // USD / 100万トークン
  output: number; // テキスト出力・思考トークン
  imageOutput?: number; // 画像出力トークン
};

export type UsageCost = {
  input_tokens: number;
  output_tokens: number;
  thought_tokens: number;
  image_tokens: number;
  cost_usd: number;
};

function modalityTokens(list: any, modality: string): number {
  if (!Array.isArray(list)) return 0;
  return list
    .filter((m) => String(m?.modality ?? '').toLowerCase() === modality)
    .reduce((sum, m) => sum + (Number(m?.tokens) || 0), 0);
}

/**
 * usage から料金を計算する。
 * total_output_tokens に思考トークンは含まれない前提（total_thought_tokens を別に足す）。
 * 画像を返したのにモダリティ別の内訳がない場合は、出力トークンを全て画像として数える（過小評価を避ける）。
 */
export function computeCost(usage: any, price: Price, hasImage = false): UsageCost {
  const input = Number(usage?.total_input_tokens) || 0;
  const output = Number(usage?.total_output_tokens) || 0;
  const thought = Number(usage?.total_thought_tokens) || 0;
  let image = modalityTokens(usage?.output_tokens_by_modality, 'image');
  if (hasImage && image === 0) image = output;
  const textOut = Math.max(0, output - image);
  const usd = (input * price.input + (textOut + thought) * price.output + image * (price.imageOutput ?? price.output)) / 1e6;
  return {
    input_tokens: input,
    output_tokens: output,
    thought_tokens: thought,
    image_tokens: image,
    cost_usd: Math.round(usd * 1e6) / 1e6,
  };
}
