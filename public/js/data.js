// Supabase とのやりとり + オフライン用キャッシュ / 送信待ちキュー
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import { DEFAULT_SETTINGS, newSrs, answer, dayStart, dayEnd } from './srs.js';
import { sanitizeSentence, extractWord, uuid } from './lib.js';

export const configured = !SUPABASE_URL.includes('YOUR_') && !SUPABASE_ANON_KEY.includes('YOUR_');
export const sb = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const BUCKET = 'anki-media';
const SIGNED_TTL = 60 * 60 * 24 * 7; // 署名付きURLの有効期限（秒）

// ---------- localStorage ----------
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`am:${key}`);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`am:${key}`, JSON.stringify(value));
    } catch {
      /* 容量不足などは無視（キャッシュなので失っても再取得できる） */
    }
  },
};

function check({ data, error }) {
  if (error) throw new Error(error.message || String(error));
  return data;
}

// ---------- 認証 ----------
export async function currentUser() {
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.user ?? null;
}

export async function signIn(email, password) {
  check(await sb.auth.signInWithPassword({ email, password }));
}

export async function signOut() {
  await sb.auth.signOut();
  localStorage.clear();
}

// ---------- 設定 ----------
export function cachedSettings() {
  return { ...DEFAULT_SETTINGS, ...store.get('settings', {}) };
}

export async function loadSettings() {
  try {
    const row = check(await sb.from('anki_settings').select('data').maybeSingle());
    store.set('settings', row?.data ?? {});
  } catch (e) {
    if (navigator.onLine) throw e;
  }
  return cachedSettings();
}

export async function saveSettings(data) {
  const user = await currentUser();
  check(await sb.from('anki_settings').upsert({ user_id: user.id, data }, { onConflict: 'user_id' }));
  store.set('settings', data);
  return cachedSettings();
}

// ---------- 画像 ----------
const urlCache = new Map(Object.entries(store.get('urls', {})));

async function uploadImage(blob) {
  const user = await currentUser();
  const path = `${user.id}/${uuid()}.jpg`;
  check(await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || 'image/jpeg' }));
  return path;
}

async function removeImages(paths) {
  const list = paths.filter(Boolean);
  if (list.length) await sb.storage.from(BUCKET).remove(list);
}

// paths → 表示用URL。期限が近いものだけ再署名する
export async function signUrls(paths) {
  const now = Date.now();
  const need = [...new Set(paths.filter(Boolean))].filter((p) => {
    const hit = urlCache.get(p);
    return !hit || hit.exp < now + 24 * 3600 * 1000;
  });
  if (need.length && navigator.onLine) {
    try {
      const res = check(await sb.storage.from(BUCKET).createSignedUrls(need, SIGNED_TTL));
      for (const r of res) {
        if (r.signedUrl) urlCache.set(r.path, { url: r.signedUrl, exp: now + SIGNED_TTL * 1000 });
      }
      store.set('urls', Object.fromEntries(urlCache));
    } catch (e) {
      console.warn('画像URLの取得に失敗', e);
    }
  }
  return (p) => (p ? urlCache.get(p)?.url ?? '' : '');
}

// ---------- カード ----------
function fromRow(r) {
  return {
    id: r.id,
    word: r.word,
    sentence: r.sentence,
    meaning: r.meaning,
    image: r.image,
    refImage: r.ref_image,
    source: r.source,
    srs: r.srs,
    created: r.created_at,
  };
}

// state: '' | 'new' | 'learning'（再学習を含む） | 'review'
export async function listCards(q = '', offset = 0, limit = 48, state = '') {
  let query = sb.from('anki_cards').select('*', { count: 'exact' }).order('created_at', { ascending: false });
  if (state === 'learning') query = query.in('state', ['learning', 'relearning']);
  else if (state) query = query.eq('state', state);
  if (q) {
    const s = q.replace(/[%,()]/g, ' ');
    query = query.or(`word.ilike.%${s}%,sentence.ilike.%${s}%,meaning.ilike.%${s}%`);
  }
  const { data, count, error } = await query.range(offset, offset + limit - 1);
  if (error) throw new Error(error.message);
  return { total: count ?? 0, cards: data.map(fromRow) };
}

export async function getCard(id) {
  return fromRow(check(await sb.from('anki_cards').select('*').eq('id', id).single()));
}

// image / refImage には { blob } (新規画像) / 文字列 (既存パス) / null (なし) を渡す
export async function saveCard(input, existing = null) {
  const sentence = sanitizeSentence(input.sentence);
  if (!sentence.replace(/<[^>]*>/g, '').trim()) throw new Error('センテンスが空です');

  const resolve = async (v) => (v && v.blob ? uploadImage(v.blob) : v || null);
  const image = await resolve(input.image);
  const refImage = await resolve(input.refImage);

  const row = {
    word: (input.word || extractWord(sentence)).trim(),
    sentence,
    meaning: String(input.meaning ?? '').trim(),
    image,
    ref_image: refImage,
    source: input.source ?? null,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const card = fromRow(check(await sb.from('anki_cards').update(row).eq('id', existing.id).select().single()));
    await removeImages([existing.image, existing.refImage].filter((p) => p && p !== image && p !== refImage));
    return card;
  }
  const srs = newSrs(cachedSettings());
  return fromRow(check(await sb.from('anki_cards').insert({ ...row, srs, state: srs.state, due: srs.due }).select().single()));
}

export async function deleteCard(card) {
  check(await sb.from('anki_cards').delete().eq('id', card.id));
  await removeImages([card.image, card.refImage]);
}

export async function resetCard(card) {
  const srs = newSrs(cachedSettings());
  check(await sb.from('anki_cards').update({ srs, state: srs.state, due: srs.due }).eq('id', card.id));
}

export async function importCards(rows, onProgress) {
  const srs = newSrs(cachedSettings());
  const prepared = rows
    .map((r) => {
      const sentence = sanitizeSentence(r.sentence);
      return {
        word: (r.word || extractWord(sentence)).trim(),
        sentence,
        meaning: String(r.meaning ?? '').trim(),
        source: r.source ?? null,
        srs,
        state: srs.state,
        due: srs.due,
      };
    })
    .filter((r) => r.sentence.replace(/<[^>]*>/g, '').trim());
  for (let i = 0; i < prepared.length; i += 200) {
    check(await sb.from('anki_cards').insert(prepared.slice(i, i + 200)));
    onProgress?.(Math.min(prepared.length, i + 200), prepared.length);
  }
  return prepared.length;
}

// ---------- 復習 ----------
// 送信待ちの回答。オフラインでも復習できるように端末に貯めておき、つながったら送る
let outbox = store.get('outbox', []);
let flushing = null;

export function pendingCount() {
  return outbox.length;
}

export function flush() {
  if (!flushing) {
    flushing = (async () => {
      try {
        while (outbox.length && navigator.onLine) {
          const op = outbox[0];
          const log = await sb.from('anki_revlog').upsert(
            { op_id: op.opId, card_id: op.cardId, ts: op.ts, rating: op.rating, prev_state: op.prevState, interval: op.srs.interval },
            { onConflict: 'op_id', ignoreDuplicates: true }
          );
          // 23503 = 外部キー違反（その間にカードが削除された）→ 捨てる
          if (log.error && log.error.code !== '23503') throw new Error(log.error.message);
          if (!log.error) {
            check(await sb.from('anki_cards').update({ srs: op.srs, state: op.srs.state, due: op.srs.due }).eq('id', op.cardId));
          }
          outbox.shift();
          store.set('outbox', outbox);
        }
      } catch (e) {
        console.warn('同期を中断（あとで再送します）', e);
      } finally {
        flushing = null;
      }
    })();
  }
  return flushing;
}

window.addEventListener('online', () => flush());

// 今日の復習対象を取得。オフラインなら前回のキャッシュを使う
export async function loadQueue() {
  const settings = cachedSettings();
  const now = Date.now();
  const ds = dayStart(now, settings);
  const de = dayEnd(now, settings);
  let cards;
  try {
    await flush();
    if (outbox.length) throw new Error('未送信の回答があるためキャッシュを使用');
    const learning = check(await sb.from('anki_cards').select('*').in('state', ['learning', 'relearning']).order('due').limit(1000));
    const review = check(await sb.from('anki_cards').select('*').eq('state', 'review').lt('due', de).order('due').limit(2000));
    const { count } = await sb
      .from('anki_revlog')
      .select('id', { count: 'exact', head: true })
      .eq('prev_state', 'new')
      .gte('ts', ds);
    const newLeft = Math.max(0, settings.newPerDay - (count ?? 0));
    const fresh = newLeft
      ? check(await sb.from('anki_cards').select('*').eq('state', 'new').order('created_at').limit(newLeft))
      : [];
    cards = [...learning, ...review, ...fresh].map(fromRow);
    store.set('queue', { day: ds, cards, newDone: count ?? 0 });
  } catch (e) {
    const cached = store.get('queue', null);
    if (!cached) throw e;
    // キャッシュの新規カードは取得時点で上限内に絞ってあるのでそのまま使う
    cards = cached.cards;
  }
  const visible = cards.filter((c) => c.srs.state !== 'review' || c.srs.due < de);
  await signUrls(visible.flatMap((c) => [c.image, c.refImage]));
  return { cards: visible, settings, dayEnd: de };
}

export function recordAnswer(card, rating, settings) {
  const ts = Date.now();
  const next = answer(card.id, card.srs, rating, ts, settings);
  outbox.push({ opId: uuid(), cardId: card.id, rating, ts, prevState: card.srs.state, srs: next });
  store.set('outbox', outbox);
  card.srs = next;

  // キャッシュ中のキューにも反映（オフライン継続用）
  const cached = store.get('queue', null);
  if (cached) {
    const c = cached.cards.find((x) => x.id === card.id);
    if (c) c.srs = next;
    store.set('queue', cached);
  }
  flush();
  return next;
}
