// Ankiもどき: 単語の「ネイティブのイメージ」と画像を Gemini で生成する Edge Function
// APIキーはブラウザに置かず、Supabase の Secrets（GEMINI_API_KEY）から読む。
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  GEMINI_ENDPOINT,
  IMAGERY_SCHEMA,
  IMAGERY_SYSTEM,
  imageryPrompt,
  extractText,
  extractImage,
  parseJsonText,
  computeCost,
  type Price,
} from '../_shared/gemini.ts';

const env = (k: string, d = '') => Deno.env.get(k) ?? d;
const num = (k: string, d: number) => {
  const v = Number(Deno.env.get(k));
  return Number.isFinite(v) && Deno.env.get(k) !== '' && Deno.env.get(k) != null ? v : d;
};

const API_KEY = env('GEMINI_API_KEY');
const TEXT_MODEL = env('ANKI_TEXT_MODEL', 'gemini-3.5-flash-lite');
const IMAGE_MODEL = env('ANKI_IMAGE_MODEL', 'gemini-3.1-flash-lite-image');
const TEXT_THINKING = env('ANKI_TEXT_THINKING', 'low');
const TEXT_PRICE: Price = { input: num('ANKI_PRICE_TEXT_INPUT', 0.3), output: num('ANKI_PRICE_TEXT_OUTPUT', 2.5) };
const IMAGE_PRICE: Price = {
  input: num('ANKI_PRICE_IMAGE_INPUT', 0.25),
  output: num('ANKI_PRICE_IMAGE_OUTPUT_TEXT', 1.5),
  imageOutput: num('ANKI_PRICE_IMAGE_OUTPUT_IMAGE', 30),
};
const MONTHLY_BUDGET = num('ANKI_MONTHLY_BUDGET_USD', 5);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

class GeminiError extends Error {
  constructor(message: string, public usage: any, public latency: number) {
    super(message);
  }
}

async function interact(body: Record<string, unknown>) {
  const t0 = Date.now();
  const res = await fetch(GEMINI_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
    body: JSON.stringify({ ...body, store: false }),
  });
  const json = await res.json().catch(() => ({}));
  const latency = Date.now() - t0;
  if (!res.ok || (json.status && json.status !== 'completed')) {
    const msg = json?.error?.message || json?.status || `HTTP ${res.status}`;
    throw new GeminiError(`Gemini API: ${msg}`, json?.usage, latency);
  }
  return { json, latency };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  if (!API_KEY) return reply(500, { error: 'GEMINI_API_KEY が設定されていません（README の「AIイメージ生成」参照）' });

  // ----- 認証: ログイン中の本人だけ -----
  const authHeader = req.headers.get('Authorization') ?? '';
  const asUser = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData } = await asUser.auth.getUser();
  const user = userData?.user;
  if (!user) return reply(401, { error: 'ログインが必要です' });
  const { data: isOwner } = await asUser.rpc('anki_is_owner');
  if (!isOwner) return reply(403, { error: 'このアカウントでは利用できません' });

  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));

  // ----- 月の上限チェック -----
  if (MONTHLY_BUDGET > 0) {
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    const { data: rows } = await admin
      .from('anki_ai_usage')
      .select('cost_usd')
      .eq('user_id', user.id)
      .gte('created_at', start.toISOString());
    const spent = (rows ?? []).reduce((s: number, r: any) => s + Number(r.cost_usd), 0);
    if (spent >= MONTHLY_BUDGET) {
      return reply(402, { error: `今月の上限 $${MONTHLY_BUDGET} に達しました（使用済み $${spent.toFixed(4)}）。ANKI_MONTHLY_BUDGET_USD で変更できます` });
    }
  }

  const body = await req.json().catch(() => ({}));
  const mode = body.mode === 'image' ? 'image' : 'full';
  const word = String(body.word ?? '').trim().slice(0, 100);
  const sentence = String(body.sentence ?? '').trim().slice(0, 1000);
  const title = String(body.title ?? '').trim().slice(0, 200);
  const requestId = crypto.randomUUID();
  const steps: any[] = [];

  async function log(step: string, model: string, price: Price, cost: ReturnType<typeof computeCost>, extra: Record<string, unknown>) {
    const row = { user_id: user!.id, request_id: requestId, word, step, model, ...cost, prices: price, ...extra };
    steps.push({ step, model, ...cost, ok: extra.ok !== false });
    const { error } = await admin.from('anki_ai_usage').insert(row);
    if (error) console.error('usage log failed', error);
  }

  async function run<T>(step: string, model: string, price: Price, call: () => Promise<{ json: any; latency: number }>, hasImage: (json: any) => boolean, read: (json: any) => T) {
    try {
      const { json, latency } = await call();
      const cost = computeCost(json.usage, price, hasImage(json));
      await log(step, model, price, cost, { latency_ms: latency, images: hasImage(json) ? 1 : 0, ok: true });
      return read(json);
    } catch (e) {
      const usage = e instanceof GeminiError ? e.usage : null;
      await log(step, model, price, computeCost(usage, price), {
        latency_ms: e instanceof GeminiError ? e.latency : null,
        ok: false,
        error: String((e as Error).message).slice(0, 500),
      });
      throw e;
    }
  }

  try {
    // ----- ① 文脈からイメージを分析 -----
    let imagery: any = body.imagery ?? null;
    if (mode === 'full') {
      if (!word || !sentence) return reply(400, { error: '単語とセンテンスが必要です' });
      const shot = body.screenshot?.data ? body.screenshot : null;
      const input: any[] = [{ type: 'text', text: imageryPrompt({ sentence, word, title, hasScreenshot: !!shot }) }];
      if (shot) input.push({ type: 'image', mime_type: shot.mime_type || 'image/jpeg', data: shot.data });
      imagery = await run(
        'concept',
        TEXT_MODEL,
        TEXT_PRICE,
        () =>
          interact({
            model: TEXT_MODEL,
            system_instruction: IMAGERY_SYSTEM,
            input,
            response_format: { type: 'json_schema', json_schema: { name: 'Imagery', schema: IMAGERY_SCHEMA } },
            generation_config: { thinking_level: TEXT_THINKING, max_output_tokens: 2048 },
          }),
        () => false,
        (json) => parseJsonText(extractText(json)),
      );
    }
    const prompt = String(imagery?.image_prompt ?? body.image_prompt ?? '').trim();
    if (!prompt) return reply(400, { error: '画像のプロンプトがありません' });

    // ----- ② そのイメージに沿った画像を生成 -----
    const image = await run(
      'image',
      IMAGE_MODEL,
      IMAGE_PRICE,
      () =>
        interact({
          model: IMAGE_MODEL,
          input: [{ type: 'text', text: prompt }],
          response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: '16:9', image_size: '1K' },
        }),
      (json) => !!extractImage(json),
      (json) => {
        const img = extractImage(json);
        if (!img) throw new Error('画像が返ってきませんでした（安全フィルタで拒否された可能性があります）');
        return img;
      },
    );

    return reply(200, {
      request_id: requestId,
      imagery: { ...imagery, models: { text: mode === 'full' ? TEXT_MODEL : imagery?.models?.text, image: IMAGE_MODEL } },
      image,
      usage: { steps, cost_usd: Math.round(steps.reduce((s, x) => s + x.cost_usd, 0) * 1e6) / 1e6 },
    });
  } catch (e) {
    return reply(502, { error: (e as Error).message, usage: { steps } });
  }
});
