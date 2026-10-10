// Gemini Interactions API 用の小物（Edge Function と Node のテストの両方から import する）
// ※ Node の型ストリップで動くよう、型注釈だけの TypeScript で書く（enum や namespace は使わない）

export const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';

// ---------- プロンプト ----------

export const IMAGERY_SYSTEM = `You help Japanese learners of English acquire the mental image a native English speaker has for a word or phrase, instead of a Japanese dictionary translation.

Work in this order:
1. Identify the exact sense of the target expression as it is used in THIS sentence (word-sense disambiguation). Use the sentence, the video title and the screenshot (if given) only for this.
2. Find the core image of that sense: the physical action, movement, shape or force a native speaker feels underneath the word. Use the word's parts and origin when they help (e.g. em- "into" + body → "put something formless into a body"; de- "away" + flect "bend" → "bend something away from you"). If the literal origin conflicts with this sense, use the picture that fits this sense.
3. Explain how that core image maps onto the situation in this sentence (scene_ja). This is the ONLY place where the sentence's topic appears.
4. Design a visual metaphor that shows the MECHANISM of the word with concrete, everyday objects:
   - Abstract away the sentence's own topic. Do NOT draw the sentence's subjects or objects (people, feelings, relationships, places in the sentence). Replace them with neutral stand-ins (e.g. a shapeless glowing liquid, a clay figure, a ball, a box, a hand, a plant).
   - The picture must show the action or change the word expresses, not a mood. Prefer a literal, physical demonstration.
   - Self-check: could a native speaker who sees only the picture guess this word or a very close synonym? If not, choose a more literal metaphor.
   Examples:
   - "gloss over" (avoid dealing with a problem): a hand brushing a thick shiny coat of varnish over a deep crack in a wooden table so the crack disappears.
   - "embody" (give a physical form to an idea or quality): a stream of colorful, shapeless mist being poured from a jar into a hollow clay figure; the part already filled has become solid and colorful.
5. Write image_prompt describing exactly that picture.

The learner already has the real screenshot on the card, so the image must NOT recreate the video scene or the sentence's situation.

Rules for image_prompt:
- English, 40-90 words. Name the concrete objects, the action, and where they are placed in the frame.
- One clear focal point, readable at thumbnail size. If the word describes a change or process, a two-part composition (before on the left → after on the right, joined by a simple arrow) is allowed.
- Never depict the sentence's own topic, the screenshot's setting, people, clothing or props. If a person is needed, show only generic hands or a simple generic figure (never real or recognizable people, actors or characters).
- Do not use glowing auras, sparkles, light swirls, silhouettes, dreamy or symbolic imagery (hearts, light beams); they hide the mechanism.
- No text, letters, numbers, captions, subtitles, logos or speech bubbles.
- Style: simple storybook-style flat vector illustration with clear outlines, solid colors, plain light background, even lighting, 16:9. Do not call it a diagram, infographic or dictionary illustration (that invites labels).

Japanese fields must sound natural to a Japanese reader and describe a picture or feeling, not list dictionary equivalents.`;

export const IMAGERY_SCHEMA = {
  type: 'object',
  properties: {
    sense_en: { type: 'string', description: 'The sense used in this sentence, plain English, max 20 words.' },
    core_image_en: { type: 'string', description: 'What a native speaker pictures/feels, max 40 words.' },
    core_image_ja: { type: 'string', description: 'core image in Japanese as a scene or sensation, not a translation. Max 80 characters.' },
    scene_ja: { type: 'string', description: 'How the core image fits the situation of this sentence, in Japanese. Max 80 characters.' },
    meaning_ja: { type: 'string', description: 'A short Japanese gloss for this context only (one expression, about 10 characters).' },
    visual_metaphor: { type: 'string', description: 'The concrete objects and action chosen in step 4, without the sentence topic. Max 30 words.' },
    image_prompt: { type: 'string', description: 'Image generation prompt that depicts the visual metaphor (not the sentence topic or video scene), following the rules.' },
  },
  required: ['sense_en', 'core_image_en', 'core_image_ja', 'scene_ja', 'meaning_ja', 'visual_metaphor', 'image_prompt'],
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

// ---------- リクエスト（Edge Function とお試しスクリプトで共通） ----------

type Screenshot = { mime_type?: string; data: string } | null | undefined;

export function imageryRequest(model: string, thinking: string, input: ImageryInput, screenshot?: Screenshot) {
  const content: any[] = [{ type: 'text', text: imageryPrompt({ ...input, hasScreenshot: !!screenshot?.data }) }];
  if (screenshot?.data) content.push({ type: 'image', mime_type: screenshot.mime_type || 'image/jpeg', data: screenshot.data });
  return {
    model,
    system_instruction: IMAGERY_SYSTEM,
    input: content,
    response_format: { type: 'text', mime_type: 'application/json', schema: IMAGERY_SCHEMA },
    generation_config: { thinking_level: thinking, max_output_tokens: 2048 },
  };
}

// 画像に文字が入ると「単語を絵で感じる」目的を壊すので、指示文の書き忘れに関係なく必ず付け足す
export const IMAGE_SUFFIX =
  ' Absolutely no text anywhere in the image: no words, letters, labels, captions, numbers or signs. Communicate only with objects and action.';

export function imageRequest(model: string, prompt: string) {
  return {
    model,
    input: [{ type: 'text', text: prompt.trim() + IMAGE_SUFFIX }],
    response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: '16:9', image_size: '1K' },
  };
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
