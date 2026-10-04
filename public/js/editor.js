// カード作成・編集フォーム
import * as data from './data.js';
import { sanitizeSentence, extractWord, escapeHtml, highlightWord, stripHtml } from './lib.js';

const SIZE = { image: 960, refImage: 640 }; // 自動リサイズ後の最大幅(px)

// 画像を最大幅に縮小して JPEG にする（透過は白で塗る）
export async function resizeImage(blob, maxWidth) {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, maxWidth / bmp.width);
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
}

async function dataUrlToBlob(url) {
  return (await fetch(url)).blob();
}

const fetchWithTimeout = (url, ms = 8000) => fetch(url, { signal: AbortSignal.timeout(ms) });

// 英英辞典: Wiktionary（句動詞にも強い）→ だめなら Free Dictionary API
async function wiktionary(word) {
  const res = await fetchWithTimeout(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Wiktionary ${res.status}`);
  const json = await res.json();
  return (json.en || [])
    .map((m) => ({
      pos: m.partOfSpeech,
      defs: m.definitions
        .map((d) => ({
          definition: stripHtml(d.definition),
          example: stripHtml(d.parsedExamples?.[0]?.example || d.examples?.[0] || ''),
        }))
        .filter((d) => d.definition),
    }))
    .filter((m) => m.defs.length);
}

async function freeDictionary(word) {
  const res = await fetchWithTimeout(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`dictionaryapi ${res.status}`);
  const entries = await res.json();
  return entries.flatMap((e) => e.meanings.map((m) => ({ pos: m.partOfSpeech, defs: m.definitions })));
}

async function lookup(word) {
  const candidates = [...new Set([word, word.toLowerCase()])];
  for (const source of [wiktionary, freeDictionary]) {
    try {
      for (const w of candidates) {
        const found = await source(w);
        if (found.length) return found;
      }
    } catch (e) {
      console.warn('辞書の取得に失敗', e);
    }
  }
  return [];
}

// 英文 → 日本語。非公式エンドポイントなので失敗したら Google 翻訳のタブを開く
async function translate(text) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ja&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error('translate failed');
  const json = await res.json();
  return json[0].map((x) => x[0]).join('');
}

const googleTranslateUrl = (t) => `https://translate.google.com/?sl=en&tl=ja&op=translate&text=${encodeURIComponent(t)}`;
const imageSearchUrl = (w) => `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(w)}`;

/**
 * @param {HTMLElement} root
 * @param {{ card?: object, capture?: object, onSaved: Function, onDeleted?: Function, toast: Function }} opts
 * @returns {() => void} 後片付け関数
 */
export function renderEditor(root, { card = null, capture = null, onSaved, onDeleted, toast }) {
  const isNew = !card;
  const source = card?.source ?? capture?.source ?? null;
  const images = {
    image: card?.image ?? null, // 文字列(既存パス) | { blob, url } | null
    refImage: card?.refImage ?? null,
  };

  root.innerHTML = `
    <h1>${isNew ? 'カードを追加' : 'カードを編集'}</h1>
    <div class="stack">
      <div>
        <div class="row" style="margin-bottom:6px">
          <span class="muted">センテンス（i+1 の英文）</span>
          <span class="spacer"></span>
          <button class="btn small" id="hlBtn" title="Alt+H">🖍 単語を色付け</button>
        </div>
        <div id="sentence" class="editor-sentence" contenteditable="true"
             data-placeholder="字幕の英文を貼り付け → 知らない単語を選択して「色付け」"></div>
        <div class="muted" id="wordInfo" style="margin-top:4px"></div>
      </div>

      <label class="field"><span>日本語の意味（この文脈の意味だけ）</span>
        <textarea id="meaning" rows="2" placeholder="例: 〜をうやむやにする"></textarea>
      </label>

      <details class="panel" id="dictBox" open>
        <summary><b>英英辞典</b> <span class="muted">— 文脈に合う定義を選んで「和訳」</span></summary>
        <div class="row" style="margin:8px 0">
          <a class="btn small" id="imgSearch" target="_blank" rel="noopener">🔎 Google画像検索</a>
          <a class="btn small" id="cambridge" target="_blank" rel="noopener">Cambridge</a>
          <a class="btn small" id="longman" target="_blank" rel="noopener">Longman</a>
        </div>
        <div class="dict" id="dict"><p class="muted">単語を色付けすると定義が表示されます</p></div>
      </details>

      <div class="img-grid">
        <div>
          <div class="muted">画像（動画のスクショ）</div>
          <div class="dropzone" id="zone-image" tabindex="0"></div>
        </div>
        <div>
          <div class="muted">語源 / イメージ画像</div>
          <div class="dropzone" id="zone-refImage" tabindex="0"></div>
        </div>
      </div>
      <p class="muted" style="margin:4px 0 0">画像は Ctrl+V で貼り付け・ドラッグ＆ドロップ・クリックで選択。自動で縮小されます。</p>

      ${source ? `<p class="muted">出典: <a href="${escapeHtml(source.url)}" target="_blank" rel="noopener">${escapeHtml(source.title || source.url)}</a></p>` : ''}

      <div class="row">
        <button class="btn primary" id="save">保存 <span class="muted" style="color:inherit;opacity:.8">Ctrl+Enter</span></button>
        ${isNew ? '' : '<button class="btn" id="reset">学習をリセット</button><span class="spacer"></span><button class="btn danger" id="del">削除</button>'}
      </div>
    </div>`;

  const $ = (s) => root.querySelector(s);
  const sentenceEl = $('#sentence');
  const meaningEl = $('#meaning');
  let activeZone = 'image';
  let lastWord = '';

  // ----- センテンス -----
  if (card) {
    sentenceEl.innerHTML = sanitizeSentence(card.sentence);
    meaningEl.value = card.meaning;
  } else if (capture) {
    sentenceEl.innerHTML = highlightWord(capture.sentence || '', capture.word || '');
  }

  sentenceEl.addEventListener('paste', (e) => {
    const text = e.clipboardData.getData('text/plain');
    if (!text) return; // 画像の貼り付けはグローバルの paste ハンドラへ
    e.preventDefault();
    document.execCommand('insertText', false, text.replace(/\s+/g, ' '));
  });

  function toggleHighlight() {
    const sel = window.getSelection();
    if (!sel.rangeCount || !sentenceEl.contains(sel.anchorNode)) return toast('センテンス内の単語を選択してください');
    const range = sel.getRangeAt(0);
    const parentHl = (n) => (n.nodeType === 3 ? n.parentElement : n)?.closest?.('.hl');
    const existing = parentHl(range.startContainer);
    if (existing && sentenceEl.contains(existing)) {
      existing.replaceWith(...existing.childNodes);
    } else {
      if (range.collapsed) return toast('色付けする単語を選択してください');
      // 前後の空白は色付けしない
      const text = range.toString();
      const span = document.createElement('span');
      span.className = 'hl';
      span.textContent = text.trim();
      range.deleteContents();
      const frag = document.createDocumentFragment();
      if (/^\s/.test(text)) frag.append(' ');
      frag.append(span);
      if (/\s$/.test(text)) frag.append(' ');
      range.insertNode(frag);
    }
    sel.removeAllRanges();
    sentenceEl.normalize();
    onSentenceChange();
  }
  $('#hlBtn').addEventListener('click', toggleHighlight);

  function currentWord() {
    return extractWord(sanitizeSentence(sentenceEl.innerHTML));
  }

  function onSentenceChange() {
    const w = currentWord();
    $('#wordInfo').innerHTML = w ? `対象の単語: <b class="hl">${escapeHtml(w)}</b>` : '未知の単語を選択して色付けしてください';
    $('#imgSearch').href = imageSearchUrl(w);
    $('#cambridge').href = `https://dictionary.cambridge.org/dictionary/english/${encodeURIComponent(w)}`;
    $('#longman').href = `https://www.ldoceonline.com/dictionary/${encodeURIComponent(w.toLowerCase().replace(/\s+/g, '-'))}`;
    if (w && w !== lastWord) {
      lastWord = w;
      renderDict(w);
    }
  }
  sentenceEl.addEventListener('input', onSentenceChange);

  // ----- 辞書 -----
  async function renderDict(word) {
    const box = $('#dict');
    box.innerHTML = '<p class="muted">検索中…</p>';
    try {
      const meanings = await lookup(word);
      if (word !== lastWord) return;
      if (!meanings.length) {
        box.innerHTML = `<p class="muted">「${escapeHtml(word)}」は見つかりませんでした。原形（例: running → run）で試すか、上のリンクから調べてください。</p>`;
        return;
      }
      box.innerHTML = meanings
        .map(
          (m) => `<div class="pos">${escapeHtml(m.pos)}</div><ol>${m.defs
            .map(
              (d) => `<li><span class="def">${escapeHtml(d.definition)}</span>
                ${d.example ? `<div class="ex">${escapeHtml(d.example)}</div>` : ''}
                <div class="row" style="margin-top:2px"><button class="btn small tr-btn">和訳</button></div></li>`
            )
            .join('')}</ol>`
        )
        .join('');
    } catch (e) {
      box.innerHTML = `<p class="muted">${escapeHtml(e.message)}</p>`;
    }
  }

  $('#dict').addEventListener('click', async (e) => {
    const btn = e.target.closest('.tr-btn');
    if (!btn) return;
    const li = btn.closest('li');
    const def = li.querySelector('.def').textContent;
    btn.disabled = true;
    try {
      const ja = await translate(def);
      li.querySelector('.tr')?.remove();
      const div = document.createElement('div');
      div.className = 'tr';
      div.innerHTML = `${escapeHtml(ja)} <button class="btn small use-btn">意味に入れる</button>`;
      div.querySelector('.use-btn').addEventListener('click', () => {
        meaningEl.value = ja;
        meaningEl.focus();
      });
      li.append(div);
    } catch {
      window.open(googleTranslateUrl(def), '_blank', 'noopener');
    } finally {
      btn.disabled = false;
    }
  });

  // ----- 画像 -----
  function srcOf(v) {
    if (!v) return '';
    if (typeof v === 'string') return signed(v);
    return v.url;
  }
  let signed = () => '';
  data.signUrls([images.image, images.refImage]).then((fn) => {
    signed = fn;
    drawZone('image');
    drawZone('refImage');
  });

  function drawZone(key) {
    const zone = $(`#zone-${key}`);
    const v = images[key];
    zone.innerHTML = v
      ? `<img src="${escapeHtml(srcOf(v))}" alt=""><button class="btn small remove" title="削除">✕</button>`
      : `<div>ここに貼り付け / ドロップ<br>またはクリックして選択${key === 'refImage' ? '<br><br>Google画像で「画像をコピー」→ Ctrl+V' : ''}</div>`;
    zone.querySelector('.remove')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (v && v.url) URL.revokeObjectURL(v.url);
      images[key] = null;
      drawZone(key);
    });
  }

  async function setImage(key, blob) {
    try {
      const resized = await resizeImage(blob, SIZE[key]);
      const old = images[key];
      if (old && old.url) URL.revokeObjectURL(old.url);
      images[key] = { blob: resized, url: URL.createObjectURL(resized) };
      drawZone(key);
    } catch {
      toast('画像を読み込めませんでした');
    }
  }

  for (const key of ['image', 'refImage']) {
    const zone = $(`#zone-${key}`);
    drawZone(key);
    zone.addEventListener('focus', () => (activeZone = key));
    zone.addEventListener('mouseenter', () => (activeZone = key));
    zone.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => input.files[0] && setImage(key, input.files[0]);
      input.click();
    });
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('drag');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
    zone.addEventListener('drop', async (e) => {
      e.preventDefault();
      zone.classList.remove('drag');
      const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
      if (file) return setImage(key, file);
      const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
      if (!url) return;
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error();
        setImage(key, await res.blob());
      } catch {
        toast('このサイトの画像は直接ドロップできません。右クリック →「画像をコピー」→ Ctrl+V で貼ってください');
      }
    });
  }

  // 画像の貼り付け: テキスト入力中でなければ、選択中（または空いている方）の枠へ
  function onPaste(e) {
    const file = [...e.clipboardData.items].find((i) => i.type.startsWith('image/'))?.getAsFile();
    if (!file) return;
    e.preventDefault();
    let key = activeZone;
    if (document.activeElement === sentenceEl || document.activeElement === meaningEl || !document.activeElement?.classList.contains('dropzone')) {
      key = !images.image ? 'image' : !images.refImage ? 'refImage' : activeZone;
    }
    setImage(key, file);
  }
  document.addEventListener('paste', onPaste);

  // 拡張機能から渡されたスクショ
  if (capture?.image) dataUrlToBlob(capture.image).then((b) => setImage('image', b));

  // ----- 保存 / 削除 -----
  let saving = false;
  async function save() {
    if (saving) return;
    const sentence = sanitizeSentence(sentenceEl.innerHTML);
    if (!stripHtml(sentence)) return toast('センテンスを入力してください');
    if (!extractWord(sentence) && !confirm('単語が色付けされていません。このまま保存しますか？')) return;
    saving = true;
    $('#save').disabled = true;
    try {
      const saved = await data.saveCard(
        { sentence, meaning: meaningEl.value, image: images.image, refImage: images.refImage, source },
        card
      );
      toast(isNew ? `「${saved.word || '新しいカード'}」を追加しました` : '保存しました');
      onSaved(saved);
    } catch (e) {
      toast(`保存に失敗しました: ${e.message}`);
    } finally {
      saving = false;
      const btn = $('#save');
      if (btn) btn.disabled = false;
    }
  }
  $('#save').addEventListener('click', save);

  $('#reset')?.addEventListener('click', async () => {
    if (!confirm('このカードを未学習の状態に戻しますか？')) return;
    await data.resetCard(card);
    toast('リセットしました');
  });
  $('#del')?.addEventListener('click', async () => {
    if (!confirm('このカードを削除しますか？')) return;
    await data.deleteCard(card);
    toast('削除しました');
    onDeleted?.();
  });

  function onKey(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      save();
    } else if (e.altKey && (e.key === 'h' || e.key === 'H')) {
      e.preventDefault();
      toggleHighlight();
    }
  }
  document.addEventListener('keydown', onKey);

  onSentenceChange();
  if (!card) sentenceEl.focus();

  return () => {
    document.removeEventListener('paste', onPaste);
    document.removeEventListener('keydown', onKey);
    for (const v of Object.values(images)) if (v && v.url) URL.revokeObjectURL(v.url);
  };
}
