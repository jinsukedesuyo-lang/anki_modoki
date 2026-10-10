import * as data from './data.js';
import { previewLabel, DEFAULT_SETTINGS, dayStart } from './srs.js';
import { buildPracticePrompt, MODES } from './practice.js';
import { sanitizeSentence, escapeHtml, stripHtml, parseDelimited, highlightWord } from './lib.js';
import { renderEditor } from './editor.js';
import { icon, brandMark } from './icons.js';

const view = document.getElementById('view');
let teardown = null;
let pendingCapture = null; // Chrome 拡張機能から渡されたデータ

// ---------- 共通 ----------
let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

const isLearning = (c) => c.srs.state === 'learning' || c.srs.state === 'relearning';

function stateLabel(srs) {
  if (srs.state === 'new') return '新規';
  if (srs.state !== 'review') return '学習中';
  const days = Math.ceil((srs.due - Date.now()) / 86400000);
  return days <= 0 ? '今日' : `${days}日後`;
}

// 字幕風の英文
const caption = (sentence) => `<div class="caption"><span class="line">${sanitizeSentence(sentence)}</span></div>`;

function tile(c, signed) {
  const img = c.image ? signed(c.image) : '';
  return `<a class="tile" href="#/edit/${c.id}">
    <div class="thumb">
      ${img ? `<img src="${escapeHtml(img)}" alt="" loading="lazy">` : `<div class="noimg"><span>${sanitizeSentence(c.sentence)}</span></div>`}
      <span class="badge ${c.srs.state === 'new' ? 'new' : ''}">${stateLabel(c.srs)}</span>
    </div>
    <div class="info">
      <div class="title">${escapeHtml(c.word || stripHtml(c.sentence))}</div>
      <div class="sub">${c.meaning ? `${escapeHtml(c.meaning)} · ` : ''}${escapeHtml(stripHtml(c.sentence))}</div>
    </div>
  </a>`;
}

function renderShell() {
  document.getElementById('brand').innerHTML = `${brandMark}<span>Ankiもどき</span>`;
  const items = [
    ['', 'home', 'ホーム'],
    ['review', 'play', '復習'],
    ['new', 'add', '追加'],
    ['browse', 'library', 'カード'],
    ['settings', 'tune', '設定'],
  ];
  document.getElementById('nav').innerHTML = items
    .map(([r, ic, label]) => `<a href="#/${r}" data-route="${r}" class="${r === 'new' ? 'add' : ''}">${icon(ic)}<span>${label}</span></a>`)
    .join('');
}

function renderStatus() {
  const end = document.getElementById('mastheadEnd');
  const pending = data.pendingCount();
  end.innerHTML = !navigator.onLine
    ? `<span class="meta row" title="オフライン">${icon('offline', 18)}オフライン</span>`
    : pending
      ? `<span class="meta row" title="未送信の回答">${icon('sync', 18)}${pending}件 同期待ち</span>`
      : '';
}
window.addEventListener('online', renderStatus);
window.addEventListener('offline', renderStatus);

// ---------- ルーティング ----------
const routes = {
  '': home,
  review,
  new: editNew,
  edit,
  browse,
  import: importView,
  settings,
  login,
  practice,
  usage,
};

let routeSeq = 0;
async function router() {
  const seq = ++routeSeq;
  teardown?.();
  teardown = null;
  window.scrollTo(0, 0);
  const [name = '', arg] = location.hash.replace(/^#\/?/, '').split('/');
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === name));
  document.body.classList.toggle('no-guide', ['review', 'login'].includes(name) || !data.configured);
  renderStatus();

  if (!data.configured) return setupNeeded();
  const user = await data.currentUser();
  if (seq !== routeSeq) return; // 待っている間に別の画面遷移が起きた
  if (!user && name !== 'login') {
    location.hash = '#/login';
    return;
  }
  try {
    await (routes[name] || home)(arg);
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="empty"><p>読み込みに失敗しました: ${escapeHtml(e.message)}</p>
      <button class="btn" onclick="location.reload()">${icon('replay')}再読み込み</button></div>`;
  }
}

function setupNeeded() {
  view.innerHTML = `<div class="center-page"><div class="login">
    <div class="brand">${brandMark}<span>Ankiもどき</span></div>
    <h1>初期設定が必要です</h1>
    <p class="meta" style="font-size:14px"><code>public/config.js</code> に Supabase の Project URL と anon key を設定してください。手順は README.md にあります。</p>
  </div></div>`;
}

function login() {
  view.innerHTML = `<div class="center-page"><form class="login" id="f">
    <div class="brand">${brandMark}<span>Ankiもどき</span></div>
    <label class="field"><span class="label">メールアドレス</span><input type="email" id="email" autocomplete="username" required></label>
    <label class="field"><span class="label">パスワード</span><input type="password" id="pw" autocomplete="current-password" required></label>
    <button class="btn primary lg">ログイン</button>
  </form></div>`;
  view.querySelector('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await data.signIn(view.querySelector('#email').value, view.querySelector('#pw').value);
      await data.loadSettings();
      location.hash = '#/';
    } catch (err) {
      toast(`ログインできませんでした: ${err.message}`);
    }
  });
}

// ---------- ホーム ----------
async function home() {
  view.innerHTML = '';
  await data.loadSettings().catch(() => {});
  const { cards, dayEnd } = await data.loadQueue();
  const n = cards.filter((c) => c.srs.state === 'new').length;
  const l = cards.filter(isLearning).length;
  const r = cards.filter((c) => c.srs.state === 'review' && c.srs.due < dayEnd).length;
  const total = n + l + r;
  const cover = cards.find((c) => c.image);
  const signed = await data.signUrls([cover?.image]);

  view.innerHTML = `
    <section class="hero ${total ? '' : 'done'}">
      <a class="player ${cover ? '' : 'blank'}" href="#/review" aria-label="復習を始める">
        ${cover ? `<img src="${escapeHtml(signed(cover.image))}" alt="">` : ''}
        ${total ? `<span class="playbtn">${icon('play')}</span>` : caption('今日の分は完了しました')}
      </a>
      <h1 class="watch-title">${total ? `今日の復習 · 残り ${total} 枚` : 'おつかれさまでした'}</h1>
      <div class="watch-meta">
        <span class="n">新規 <b>${n}</b></span>·<span class="l">学習中 <b>${l}</b></span>·<span class="r">復習 <b>${r}</b></span>
      </div>
      ${data.pendingCount() ? `<div class="notice">${icon('sync')}未送信の回答 ${data.pendingCount()} 件。オンラインになると自動で同期されます</div>` : ''}
      ${navigator.onLine ? '' : `<div class="notice">${icon('offline')}オフラインです。前回読み込んだカードで復習できます</div>`}
      <div class="chips wrap" style="margin-top:12px">
        <a class="chip" href="#/new">${icon('add', 18)}カードを追加</a>
        <a class="chip" href="#/practice">${icon('chat', 18)}会話で使ってみる</a>
        <a class="chip" href="#/import">${icon('upload', 18)}CSV取り込み</a>
        <a class="chip" href="#/usage">${icon('chart', 18)}AI利用料</a>
      </div>
    </section>
    <h2>最近追加したカード</h2>
    <div class="grid" id="recent"></div>`;

  try {
    const { cards: recent } = await data.listCards('', 0, 8);
    const s = await data.signUrls(recent.map((c) => c.image));
    view.querySelector('#recent').innerHTML = recent.length
      ? recent.map((c) => tile(c, s)).join('')
      : '<p class="meta">まだカードがありません。YouTube で知らない単語を選んで Alt+A を押すか、「追加」から作成してください。</p>';
  } catch {
    // オフライン時などは「最近追加したカード」欄ごと隠す
    view.querySelector('#recent')?.previousElementSibling?.remove();
    view.querySelector('#recent')?.remove();
  }
}

// ---------- 復習（再生ページ風） ----------
async function review() {
  view.innerHTML = '';
  const { cards, settings, dayEnd } = await data.loadQueue();
  const signed = await data.signUrls(cards.flatMap((c) => [c.image, c.refImage]));
  const LEARN_AHEAD = 20 * 60 * 1000;
  let current = null;
  let showing = false;
  let answered = 0;
  let waitTimer = null;
  let ccOn = localStorage.getItem('am:cc') !== 'off';

  const remaining = () => cards.filter((c) => c.srs.state === 'new' || isLearning(c) || (c.srs.state === 'review' && c.srs.due < dayEnd));

  function pick() {
    const now = Date.now();
    const learnDue = cards.filter((c) => isLearning(c) && c.srs.due <= now).sort((a, b) => a.srs.due - b.srs.due);
    if (learnDue.length) return learnDue[0];
    const reviews = cards.filter((c) => c.srs.state === 'review' && c.srs.due < dayEnd);
    const news = cards.filter((c) => c.srs.state === 'new');
    // 復習と新規を混ぜる（4枚に1枚は新規）
    if (news.length && (!reviews.length || answered % 4 === 3)) return news[0];
    if (reviews.length) return reviews[0];
    const ahead = cards.filter((c) => isLearning(c) && c.srs.due <= now + LEARN_AHEAD).sort((a, b) => a.srs.due - b.srs.due);
    return ahead[0] ?? null;
  }

  function speak(c) {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(stripHtml(c.sentence));
    u.lang = 'en-US';
    speechSynthesis.speak(u);
  }

  function screen(title, body) {
    view.innerHTML = `<div class="watch">
      <div class="player blank">${caption(title)}</div>
      ${body}
    </div>`;
  }

  function render() {
    clearTimeout(waitTimer);
    current = pick();
    showing = false;
    if (current) return draw();
    const later = cards.filter(isLearning).sort((a, b) => a.srs.due - b.srs.due)[0];
    if (later) {
      const t = new Date(later.srs.due).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
      screen('ひと休み', `<h1 class="watch-title">次のカードは ${t} 頃に出題されます</h1>
        <div class="watch-meta">このページを開いたままにすると自動で再開します</div>
        <div class="chips"><a class="chip" href="#/">${icon('home', 18)}ホームへ</a></div>`);
      waitTimer = setTimeout(render, Math.min(60000, Math.max(1000, later.srs.due - LEARN_AHEAD - Date.now())));
      return;
    }
    screen('今日の分は完了しました', `<h1 class="watch-title">${answered} 枚回答しました</h1>
      <div class="chips"><a class="chip" href="#/">${icon('home', 18)}ホームへ</a><a class="chip active" href="#/practice">${icon('chat', 18)}会話で使ってみる</a><a class="chip" href="#/new">${icon('add', 18)}カードを追加</a></div>`);
  }

  function draw() {
    const c = current;
    const now = Date.now();
    const rest = remaining();
    const pct = Math.round((answered / (answered + rest.length || 1)) * 100);
    const showImg = showing && c.image;
    const src = c.source?.url ? `<a class="chip" href="${escapeHtml(c.source.url)}" target="_blank" rel="noopener">${icon('open', 18)}元の動画</a>` : '';

    view.innerHTML = `<div class="watch">
      <div class="player ${showImg ? '' : 'blank'} ${ccOn ? '' : 'cc-off'}" id="player">
        ${showImg ? `<img src="${escapeHtml(signed(c.image))}" alt="">` : ''}
        ${caption(c.sentence)}
        <div class="progress"><i style="width:${pct}%"></i></div>
      </div>
      ${showing
        ? `<h1 class="watch-title">${escapeHtml(c.meaning) || '<span class="meta">（意味が未入力です）</span>'}</h1>`
        : '<h1 class="watch-title pending">意味と場面を思い浮かべてから「答えを見る」</h1>'}
      <div class="watch-meta">
        <span>${escapeHtml(c.word)}</span>${c.word ? '·' : ''}<span>${stateLabel(c.srs)}</span>
        <span class="spacer"></span>
        <span class="n"><b>${rest.filter((x) => x.srs.state === 'new').length}</b></span>
        <span class="l"><b>${rest.filter((x) => isLearning(x) && x.srs.due <= now + LEARN_AHEAD).length}</b></span>
        <span class="r"><b>${rest.filter((x) => x.srs.state === 'review').length}</b></span>
      </div>
      <div class="chips">
        <button class="chip" id="speak">${icon('volume', 18)}読み上げ</button>
        ${showing ? `<button class="chip ${ccOn ? 'active' : ''}" id="cc">${icon('cc', 18)}字幕</button>${src}<a class="chip" href="#/edit/${c.id}">${icon('edit', 18)}編集</a>` : ''}
      </div>
      ${showing && (c.refImage || c.imagery?.core_image_ja)
        ? `<div class="desc">
            <div class="head">${c.imagery ? 'ネイティブのイメージ' : 'イメージ'}</div>
            ${c.imagery?.core_image_ja ? `<div style="font-size:15px;margin-bottom:4px">${escapeHtml(c.imagery.core_image_ja)}</div>` : ''}
            ${c.imagery?.scene_ja ? `<div class="meta" style="font-size:13px;margin-bottom:8px">${escapeHtml(c.imagery.scene_ja)}</div>` : ''}
            ${c.refImage ? `<img src="${escapeHtml(signed(c.refImage))}" alt="">` : ''}
          </div>`
        : ''}
      ${showing && c.source?.title ? `<div class="meta" style="margin-top:12px">${escapeHtml(c.source.title)}</div>` : ''}
    </div>
    <div class="answer-bar"><div class="inner">
      ${showing
        ? `<button class="btn" id="again">Again <small>${previewLabel(c.id, c.srs, 'again', now, settings)} <span class="kbd">· 1</span></small></button>
           <button class="btn primary" id="good">Good <small>${previewLabel(c.id, c.srs, 'good', now, settings)} <span class="kbd">· Space</span></small></button>`
        : '<button class="btn primary" id="show">答えを見る <small class="kbd">Space</small></button>'}
    </div></div>`;

    view.querySelector('#show')?.addEventListener('click', flip);
    view.querySelector('#again')?.addEventListener('click', () => rate('again'));
    view.querySelector('#good')?.addEventListener('click', () => rate('good'));
    view.querySelector('#speak').addEventListener('click', () => speak(c));
    view.querySelector('#cc')?.addEventListener('click', () => {
      ccOn = !ccOn;
      localStorage.setItem('am:cc', ccOn ? 'on' : 'off');
      draw();
    });
    if (!showing) view.querySelector('#player').addEventListener('click', flip);
  }

  function flip() {
    if (!current || showing) return;
    showing = true;
    draw();
  }

  function rate(rating) {
    if (!current || !showing) return;
    data.recordAnswer(current, rating, settings);
    answered++;
    renderStatus();
    render();
  }

  function onKey(e) {
    if (e.target.closest('input, textarea, [contenteditable]')) return;
    if (!showing && (e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault();
      flip();
    } else if (showing && e.key === '1') {
      rate('again');
    } else if (showing && (e.key === '2' || e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault();
      rate('good');
    }
  }
  document.addEventListener('keydown', onKey);
  teardown = () => {
    clearTimeout(waitTimer);
    document.removeEventListener('keydown', onKey);
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  };
  render();
}

// ---------- 追加・編集 ----------
function editNew() {
  const capture = pendingCapture;
  pendingCapture = null;
  teardown = renderEditor(view, {
    capture,
    toast,
    onSaved: () => {
      // 続けて次のカードを作れるように空のフォームを出し直す
      teardown?.();
      editNew();
    },
  });
}

async function edit(id) {
  view.innerHTML = '';
  const card = await data.getCard(id);
  teardown = renderEditor(view, {
    card,
    toast,
    onSaved: () => history.back(),
    onDeleted: () => (location.hash = '#/browse'),
  });
}

// ---------- カード一覧 ----------
async function browse() {
  view.innerHTML = `
    <div class="row" style="margin:8px 0 12px">
      <form class="search" id="sf" role="search">
        <input type="search" id="q" placeholder="単語・文・意味で検索" enterkeyhint="search">
        <button class="go" aria-label="検索">${icon('search')}</button>
      </form>
    </div>
    <div class="chips" id="filters">
      <button class="chip active" data-state="">すべて</button>
      <button class="chip" data-state="new">新規</button>
      <button class="chip" data-state="learning">学習中</button>
      <button class="chip" data-state="review">復習</button>
    </div>
    <div class="meta" id="total" style="margin-bottom:12px"></div>
    <div class="grid" id="list"></div>
    <div class="row" style="justify-content:center;margin-top:24px"><button class="btn" id="more" hidden>さらに表示</button></div>`;
  const list = view.querySelector('#list');
  let q = '';
  let state = '';
  let offset = 0;
  let timer;

  async function load(reset) {
    if (reset) {
      offset = 0;
      list.innerHTML = '';
    }
    const { total, cards } = await data.listCards(q, offset, 48, state);
    const signed = await data.signUrls(cards.map((c) => c.image));
    offset += cards.length;
    view.querySelector('#total').textContent = `${total} 枚`;
    view.querySelector('#more').hidden = offset >= total;
    if (!total) list.innerHTML = '<p class="meta">該当するカードはありません</p>';
    list.insertAdjacentHTML('beforeend', cards.map((c) => tile(c, signed)).join(''));
  }
  const search = () => {
    q = view.querySelector('#q').value.trim();
    load(true);
  };
  view.querySelector('#sf').addEventListener('submit', (e) => {
    e.preventDefault();
    search();
  });
  view.querySelector('#q').addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(search, 300);
  });
  view.querySelector('#filters').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    view.querySelectorAll('#filters .chip').forEach((c) => c.classList.toggle('active', c === chip));
    state = chip.dataset.state;
    load(true);
  });
  view.querySelector('#more').addEventListener('click', () => load(false));
  await load(true);
}

// ---------- CSV 取り込み（Language Reactor の保存単語など） ----------
function importView() {
  view.innerHTML = `<div class="narrow">
    <h1>CSV / TSV 取り込み</h1>
    <p class="meta" style="font-size:14px">Language Reactor の保存単語エクスポートなどを読み込みます。画像は取り込まれないので、必要なら後からカードを編集して追加してください。</p>
    <label class="btn" style="margin:8px 0 16px">${icon('upload')}ファイルを選択
      <input type="file" id="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" hidden></label>
    <div id="mapping"></div>
  </div>`;
  view.querySelector('#file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const rows = parseDelimited(await file.text());
    if (!rows.length) return toast('データが見つかりませんでした');
    const width = Math.max(...rows.map((r) => r.length));
    const guess = (re) => rows[0].findIndex((h) => re.test(h));
    const guessed = {
      sentence: guess(/sentence|subtitle|context|example|文|字幕/i),
      word: guess(/^(word|term|lemma|phrase|単語)/i),
      meaning: guess(/meaning|translation|definition|意味|訳/i),
    };
    const opts = (sel) =>
      `<option value="-1">（使わない）</option>` +
      Array.from({ length: width }, (_, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${i + 1}列目: ${escapeHtml((rows[0][i] || '').slice(0, 30))}</option>`).join('');
    const box = view.querySelector('#mapping');
    box.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:12px">
        <label class="row"><input type="checkbox" id="header" ${Object.values(guessed).some((i) => i >= 0) ? 'checked' : ''}> 1行目は見出し</label>
        <label class="field"><span class="label">センテンス（必須）</span><select id="m-sentence">${opts(guessed.sentence)}</select></label>
        <label class="field"><span class="label">単語（センテンス内で自動ハイライト）</span><select id="m-word">${opts(guessed.word)}</select></label>
        <label class="field"><span class="label">日本語の意味</span><select id="m-meaning">${opts(guessed.meaning)}</select></label>
        <div id="pv"></div>
        <div><button class="btn primary" id="go">取り込む</button></div>
      </div>`;

    const build = () => {
      const idx = (k) => Number(box.querySelector(`#m-${k}`).value);
      const body = box.querySelector('#header').checked ? rows.slice(1) : rows;
      const [si, wi, mi] = [idx('sentence'), idx('word'), idx('meaning')];
      return body
        .map((r) => {
          const raw = si >= 0 ? r[si] ?? '' : '';
          const word = wi >= 0 ? (r[wi] ?? '').trim() : '';
          // すでにHTML（<span class="hl"> 等）ならそのまま、プレーンテキストなら単語をハイライト
          const sentence = /<[a-z][^>]*>/i.test(raw) ? raw : highlightWord(raw, word);
          return { sentence, word, meaning: mi >= 0 ? r[mi] ?? '' : '' };
        })
        .filter((r) => stripHtml(r.sentence));
    };
    const preview = () => {
      const items = build();
      box.querySelector('#pv').innerHTML = `<div class="meta">${items.length} 件（先頭5件のプレビュー）</div>
        <table class="preview"><tr><th>センテンス</th><th>意味</th></tr>${items
          .slice(0, 5)
          .map((r) => `<tr><td>${sanitizeSentence(r.sentence)}</td><td>${escapeHtml(r.meaning)}</td></tr>`)
          .join('')}</table>`;
    };
    box.onchange = preview; // ファイルを選び直しても二重登録しない
    preview();
    box.querySelector('#go').addEventListener('click', async (ev) => {
      const items = build();
      if (!items.length) return toast('取り込めるデータがありません');
      ev.target.disabled = true;
      try {
        const n = await data.importCards(items, (done, all) => (ev.target.textContent = `取り込み中… ${done}/${all}`));
        toast(`${n} 枚取り込みました`);
        location.hash = '#/browse';
      } catch (err) {
        toast(`失敗しました: ${err.message}`);
        ev.target.disabled = false;
        ev.target.textContent = '取り込む';
      }
    });
  });
}

// ---------- 会話練習（生成AIと話して使う） ----------
async function practice() {
  view.innerHTML = '';
  const settings = data.cachedSettings();
  const ds = dayStart(Date.now(), settings);
  const [{ cards: all }, logs] = await Promise.all([data.listCards('', 0, 1000), data.reviewedCardIds(ds - 13 * 864e5)]);
  const studied = all.filter((c) => c.srs.state !== 'new');
  if (!studied.length) {
    view.innerHTML = `<div class="empty"><h1>会話で使ってみる</h1><p>復習したカードがまだありません。まずは何枚か復習してから試してください。</p>
      <a class="btn" href="#/review">${icon('play')}復習へ</a></div>`;
    return;
  }
  const todayIds = new Set(logs.filter((l) => l.ts >= ds).map((l) => l.card_id));
  const againIds = new Set(logs.filter((l) => l.rating === 'again').map((l) => l.card_id));
  const groups = {
    today: { label: '今日復習した', cards: studied.filter((c) => todayIds.has(c.id)) },
    weak: {
      label: '間違えた・苦手',
      cards: studied
        .filter((c) => againIds.has(c.id) || c.srs.lapses > 0 || c.srs.state === 'relearning')
        .sort((a, b) => (b.srs.lapses || 0) - (a.srs.lapses || 0)),
    },
    recent: { label: '最近覚えた', cards: studied.filter((c) => Date.now() - new Date(c.created).getTime() < 7 * 864e5) },
    all: { label: 'すべて', cards: studied },
  };
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem('am:practice') || '{}');
  } catch {
    /* 壊れた保存値は無視 */
  }
  const st = {
    group: Object.keys(groups).find((g) => groups[g].cards.length),
    mode: MODES[saved.mode] ? saved.mode : 'retrieval',
    level: saved.level ?? 'B1',
    voice: !!saved.voice,
    selected: new Set(),
  };
  const pickDefault = () => (st.selected = new Set(groups[st.group].cards.slice(0, 6).map((c) => c.id)));
  pickDefault();

  view.innerHTML = `<div class="narrow" style="max-width:760px">
    <h1>会話で使ってみる</h1>
    <p class="meta" style="font-size:14px">覚えた表現を ChatGPT・Claude・Gemini との会話で<b>自分の口から使う</b>ためのプロンプトを作ります。1回5〜8語、15分くらいが目安です。</p>

    <div class="sub-label" style="margin-top:20px">練習する表現</div>
    <div class="chips" id="groups"></div>
    <div class="pick-list" id="picks"></div>

    <div class="sub-label" style="margin-top:20px">進め方</div>
    <div class="chips" id="modes"></div>
    <div class="meta" id="modeHint" style="margin:-4px 0 12px"></div>
    <div class="row" style="gap:16px">
      <label class="field" style="flex:1;min-width:200px"><span class="label">英語のレベル</span>
        <select id="level"><option value="A2">A2（やさしめ）</option><option value="B1">B1（日常会話）</option><option value="B2">B2（自然なスピード）</option></select></label>
      <label class="row"><input type="checkbox" id="voice"> 音声で話す（音声モード向け）</label>
    </div>

    <div class="sub-label" style="margin-top:20px">プロンプト <span class="meta" id="pcount"></span></div>
    <textarea id="out" readonly rows="12" class="prompt-out"></textarea>
    <div class="actions" style="margin-top:12px">
      <button class="btn primary" id="copy">${icon('copy')}コピー</button>
      <button class="btn" id="chatgpt">${icon('open')}ChatGPTで開く</button>
      <button class="btn" id="claude">${icon('open')}Claudeで開く</button>
      <button class="btn" id="gemini">${icon('open')}Geminiで開く</button>
      <button class="btn ghost" id="save">${icon('download')}テキストで保存</button>
    </div>
    <div class="desc" style="margin-top:16px;font-size:13px;line-height:1.8">
      <div class="head">使い方のコツ</div>
      ・音声で話すなら「音声で話す」をオンにして、ChatGPT や Gemini アプリの音声モードで貼り付けてから話しかけます<br>
      ・詰まってもすぐ答えを聞かず、ヒントで思い出すほうが定着します<br>
      ・最後に <b>finish</b> と言うと、日本語の振り返り（自力で使えた / ヒントで使えた / 使えなかった）が出ます。使えなかった表現は、次の復習で意識してみてください
    </div>
  </div>`;

  const $ = (s) => view.querySelector(s);
  $('#level').value = st.level;
  $('#voice').checked = st.voice;

  const selectedCards = () => groups.all.cards.filter((c) => st.selected.has(c.id));
  function update() {
    localStorage.setItem('am:practice', JSON.stringify({ mode: st.mode, level: st.level, voice: st.voice }));
    $('#groups').innerHTML = Object.entries(groups)
      .map(([k, g]) => `<button class="chip ${k === st.group ? 'active' : ''}" data-g="${k}" ${g.cards.length ? '' : 'disabled'}>${g.label} <b>${g.cards.length}</b></button>`)
      .join('');
    $('#picks').innerHTML = groups[st.group].cards
      .map((c) => `<label class="pick"><input type="checkbox" data-id="${c.id}" ${st.selected.has(c.id) ? 'checked' : ''}>
        <span class="w">${escapeHtml(c.word || stripHtml(c.sentence))}</span><span class="meta">${escapeHtml(c.meaning)}</span></label>`)
      .join('');
    $('#modes').innerHTML = Object.entries(MODES)
      .map(([k, m]) => `<button class="chip ${k === st.mode ? 'active' : ''}" data-m="${k}">${m.label}</button>`)
      .join('');
    $('#modeHint').textContent = MODES[st.mode].hint;
    const cards = selectedCards();
    $('#pcount').textContent = `— ${cards.length} 語${cards.length > 8 ? '（多いと1語ずつが浅くなります。5〜8語がおすすめ）' : ''}`;
    $('#out').value = cards.length ? buildPracticePrompt({ cards, mode: st.mode, level: st.level, voice: st.voice }) : '';
  }
  $('#groups').addEventListener('click', (e) => {
    const b = e.target.closest('[data-g]');
    if (!b) return;
    st.group = b.dataset.g;
    pickDefault();
    update();
  });
  $('#picks').addEventListener('change', (e) => {
    const id = e.target.dataset.id;
    if (e.target.checked) st.selected.add(id);
    else st.selected.delete(id);
    update();
  });
  $('#modes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-m]');
    if (!b) return;
    st.mode = b.dataset.m;
    update();
  });
  $('#level').addEventListener('change', (e) => {
    st.level = e.target.value;
    update();
  });
  $('#voice').addEventListener('change', (e) => {
    st.voice = e.target.checked;
    update();
  });

  async function copy() {
    const text = $('#out').value;
    if (!text) {
      toast('練習する表現を選んでください');
      return false;
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      $('#out').select();
      document.execCommand('copy');
    }
    return true;
  }
  // 開く前にコピーしておく（URL で文章を渡せないサービスや、長すぎて切れた場合は貼り付けで済む）
  async function openWith(url, name) {
    if (!(await copy())) return;
    window.open(url, '_blank', 'noopener');
    toast(`${name}を開きました。入力欄が空なら貼り付け（Ctrl+V）してください`);
  }
  $('#copy').addEventListener('click', async () => {
    if (await copy()) toast('コピーしました。AI のチャットに貼り付けて送信してください');
  });
  $('#chatgpt').addEventListener('click', () => openWith(`https://chatgpt.com/?q=${encodeURIComponent($('#out').value)}`, 'ChatGPT'));
  $('#claude').addEventListener('click', () => openWith(`https://claude.ai/new?q=${encodeURIComponent($('#out').value)}`, 'Claude'));
  $('#gemini').addEventListener('click', () => openWith('https://gemini.google.com/app', 'Gemini'));
  $('#save').addEventListener('click', () => {
    const text = $('#out').value;
    if (!text) return toast('練習する表現を選んでください');
    download(`会話練習_${new Date().toISOString().slice(0, 10)}.txt`, text, 'text/plain');
  });
  update();
}

function download(filename, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- AI 利用料（製品化したときのコスト見積もり用） ----------
async function usage() {
  view.innerHTML = '';
  const rows = await data.listAiUsage();
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const month = rows.filter((r) => new Date(r.created_at) >= monthStart);
  const sum = (list) => list.reduce((s, r) => s + Number(r.cost_usd), 0);
  // 「生成」1回 = request_id 単位（画像まで成功したもの）。失敗した呼び出しの費用も平均に含める
  const generations = (list) => new Set(list.filter((r) => r.step === 'image' && r.ok).map((r) => r.request_id)).size;
  const genAll = generations(rows);
  const perGen = genAll ? sum(rows) / genAll : null;
  const ESTIMATE = 0.0357; // 実績が無いときの目安（分析 約$0.002 + 画像 約$0.034）
  const unit = perGen ?? ESTIMATE;
  const usd = (v, d = 4) => `$${v.toFixed(d)}`;
  const yen = (v) => {
    const y = v * data.usdJpy();
    return `${y.toLocaleString('ja-JP', { maximumFractionDigits: y < 10 ? 2 : 0 })} 円`;
  };

  // 処理 × モデル別の内訳
  const groups = {};
  for (const r of rows) {
    const g = (groups[`${r.step}|${r.model}`] ??= { step: r.step, model: r.model, n: 0, inp: 0, out: 0, img: 0, cost: 0, fail: 0 });
    g.n++;
    g.inp += r.input_tokens;
    g.out += r.output_tokens + r.thought_tokens;
    g.img += r.image_tokens;
    g.cost += Number(r.cost_usd);
    if (!r.ok) g.fail++;
  }
  const stepName = { concept: '文脈の分析', image: '画像生成' };
  let sim = { cards: 300, users: 100 };
  try {
    sim = { ...sim, ...JSON.parse(localStorage.getItem('am:sim') || '{}') };
  } catch {
    /* 壊れた保存値は無視 */
  }

  view.innerHTML = `<div style="max-width:960px">
    <h1>AI 利用料</h1>
    <div class="kpis">
      <div><span>今月の費用</span><b>${yen(sum(month))}</b><small>${usd(sum(month))} · ${generations(month)} 回生成</small></div>
      <div><span>1回の生成あたり</span><b>${yen(unit)}</b><small>${perGen == null ? '目安（まだ実績がありません）' : `${usd(unit)} · 実績 ${genAll} 回の平均`}</small></div>
      <div><span>累計</span><b>${yen(sum(rows))}</b><small>${usd(sum(rows))} · API 呼び出し ${rows.length} 回</small></div>
    </div>

    <h2>製品化したときの試算</h2>
    <div class="desc">
      <div class="form-grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
        <label class="field"><span class="label">1人あたり月の生成枚数</span><input type="number" id="simCards" min="0" value="${sim.cards}"></label>
        <label class="field"><span class="label">ユーザー数</span><input type="number" id="simUsers" min="0" value="${sim.users}"></label>
        <label class="field"><span class="label">為替（円 / ドル）</span><input type="number" id="rate" min="1" step="0.1" value="${data.usdJpy()}"></label>
      </div>
      <div class="kpis" id="simOut" style="margin-top:12px"></div>
      <div class="meta" style="margin-top:8px">1回の生成 = 文脈の分析 + 画像1枚。実績の平均単価（失敗した呼び出しの費用も含む）で計算しています。</div>
    </div>

    <h2>内訳</h2>
    ${Object.keys(groups).length
      ? `<div style="overflow-x:auto"><table class="preview">
        <tr><th>処理</th><th>モデル</th><th>回数</th><th>平均 入力</th><th>平均 出力（思考込み）</th><th>平均 画像</th><th>平均費用</th><th>合計</th></tr>
        ${Object.values(groups)
          .map((g) => `<tr><td>${stepName[g.step] ?? escapeHtml(g.step)}</td><td>${escapeHtml(g.model)}</td><td>${g.n}${g.fail ? `（失敗 ${g.fail}）` : ''}</td>
            <td>${Math.round(g.inp / g.n)}</td><td>${Math.round(g.out / g.n)}</td><td>${Math.round(g.img / g.n)}</td>
            <td>${usd(g.cost / g.n, 5)}</td><td>${usd(g.cost)}</td></tr>`)
          .join('')}
      </table></div>`
      : '<p class="meta">まだ AI を使っていません。カード作成画面の「文脈からイメージと画像を生成」を使うと、ここに記録されます。</p>'}

    <h2>履歴 <span class="meta">（新しい順 50 件）</span></h2>
    <div class="actions" style="margin-bottom:8px"><button class="btn sm" id="csv">${icon('download', 18)}CSV で書き出す（全件）</button></div>
    <div style="overflow-x:auto"><table class="preview">
      <tr><th>日時</th><th>単語</th><th>処理</th><th>トークン（入力 / 出力 / 画像）</th><th>費用</th><th>結果</th></tr>
      ${rows
        .slice(0, 50)
        .map((r) => `<tr><td>${new Date(r.created_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
          <td>${escapeHtml(r.word)}</td><td>${stepName[r.step] ?? escapeHtml(r.step)}</td>
          <td>${r.input_tokens} / ${r.output_tokens + r.thought_tokens} / ${r.image_tokens}</td>
          <td>${usd(Number(r.cost_usd), 5)}</td><td>${r.ok ? 'OK' : `<span class="meta" title="${escapeHtml(r.error || '')}">失敗</span>`}</td></tr>`)
        .join('')}
    </table></div>
  </div>`;

  const $ = (s) => view.querySelector(s);
  function renderSim() {
    const cards = Number($('#simCards').value) || 0;
    const users = Number($('#simUsers').value) || 0;
    const rate = Number($('#rate').value) || 150;
    localStorage.setItem('am:sim', JSON.stringify({ cards, users }));
    data.setUsdJpy(rate);
    const perUser = unit * cards;
    const fmt = (v) => `${Math.round(v * rate).toLocaleString('ja-JP')} 円`;
    $('#simOut').innerHTML = `
      <div><span>1人あたり / 月</span><b>${fmt(perUser)}</b><small>$${perUser.toFixed(2)}</small></div>
      <div><span>全体 / 月</span><b>${fmt(perUser * users)}</b><small>$${(perUser * users).toFixed(2)}</small></div>
      <div><span>全体 / 年</span><b>${fmt(perUser * users * 12)}</b><small>$${(perUser * users * 12).toFixed(2)}</small></div>`;
  }
  ['#simCards', '#simUsers', '#rate'].forEach((s) => $(s).addEventListener('input', renderSim));
  renderSim();

  $('#csv').addEventListener('click', () => {
    const cols = ['created_at', 'request_id', 'word', 'step', 'model', 'input_tokens', 'output_tokens', 'thought_tokens', 'image_tokens', 'images', 'cost_usd', 'latency_ms', 'ok', 'error'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\r\n');
    download(`ai_usage_${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv');
  });
}

// ---------- 設定 ----------
async function settings() {
  const s = await data.loadSettings();
  const user = await data.currentUser();
  const field = (key, label) =>
    `<label class="field"><span class="label">${label}</span>
      <input type="text" inputmode="decimal" id="s-${key}" value="${escapeHtml(Array.isArray(s[key]) ? s[key].join(' ') : s[key])}"></label>`;
  view.innerHTML = `<div class="narrow">
    <h1>設定</h1>
    <form id="f">
      <div class="form-grid">
        ${field('newPerDay', '1日の新規カード数')}
        ${field('dayStartHour', '1日の区切り（時）')}
        ${field('learningSteps', '学習ステップ（分・スペース区切り）')}
        ${field('relearningSteps', 'Again 後の再学習ステップ（分）')}
        ${field('graduatingInterval', '卒業間隔（日）')}
        ${field('maxInterval', '最大間隔（日）')}
        ${field('startingEase', '初期 Ease')}
        ${field('lapseEasePenalty', 'Again 時の Ease 減少')}
      </div>
      <div class="actions" style="margin-top:16px">
        <button class="btn primary">保存</button>
        <button class="btn ghost" type="button" id="def">初期値に戻す</button>
      </div>
    </form>
    <div class="section">
      <h2>アカウント</h2>
      <div class="meta" style="font-size:14px">${escapeHtml(user?.email ?? '')}</div>
      <div class="meta">未送信の回答: ${data.pendingCount()} 件</div>
      <div class="actions" style="margin-top:12px">
        <button class="btn" id="sync">${icon('sync')}今すぐ同期</button>
        <button class="btn" id="import">${icon('upload')}CSV取り込み</button>
        <a class="btn" href="#/usage">${icon('chart')}AI利用料</a>
        <a class="btn" href="#/practice">${icon('chat')}会話練習</a>
        <button class="btn ghost danger" id="logout">${icon('logout')}ログアウト</button>
      </div>
    </div>
  </div>`;
  const form = view.querySelector('#f');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = {};
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      const raw = form.querySelector(`#s-${key}`).value.trim();
      if (Array.isArray(DEFAULT_SETTINGS[key])) {
        const arr = raw.split(/[\s,]+/).map(Number).filter((n) => n > 0);
        out[key] = arr.length ? arr : DEFAULT_SETTINGS[key];
      } else {
        const n = Number(raw);
        out[key] = Number.isFinite(n) && raw !== '' ? n : DEFAULT_SETTINGS[key];
      }
    }
    await data.saveSettings(out);
    toast('保存しました');
  });
  view.querySelector('#def').addEventListener('click', async () => {
    await data.saveSettings({});
    toast('初期値に戻しました');
    settings();
  });
  view.querySelector('#import').addEventListener('click', () => (location.hash = '#/import'));
  view.querySelector('#sync').addEventListener('click', async () => {
    await data.flush();
    renderStatus();
    toast(data.pendingCount() ? `まだ ${data.pendingCount()} 件残っています（オフライン？）` : '同期しました');
  });
  view.querySelector('#logout').addEventListener('click', async () => {
    if (data.pendingCount() && !confirm('未送信の回答が失われます。ログアウトしますか？')) return;
    await data.signOut();
    location.hash = '#/login';
  });
}

// ---------- Chrome 拡張機能からの受け取り ----------
function receiveCapture(detail) {
  if (!detail) return;
  pendingCapture = detail;
  window.__ankiCapture = null;
  if (location.hash === '#/new') router();
  else location.hash = '#/new';
}
window.addEventListener('anki-capture', (e) => receiveCapture(e.detail));

// ---------- 起動 ----------
renderShell();
window.addEventListener('hashchange', router);
if (window.__ankiCapture) {
  pendingCapture = window.__ankiCapture;
  window.__ankiCapture = null;
  location.hash = '#/new';
}
router();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service Worker 登録失敗', e));
}
