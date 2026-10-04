import * as data from './data.js';
import { previewLabel, DEFAULT_SETTINGS } from './srs.js';
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
      <div class="chips" style="margin-top:12px">
        <a class="chip" href="#/new">${icon('add', 18)}カードを追加</a>
        <a class="chip" href="#/import">${icon('upload', 18)}CSV取り込み</a>
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
      <div class="chips"><a class="chip" href="#/">${icon('home', 18)}ホームへ</a><a class="chip" href="#/new">${icon('add', 18)}カードを追加</a></div>`);
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
      ${showing && c.refImage ? `<div class="desc"><div class="head">イメージ</div><img src="${escapeHtml(signed(c.refImage))}" alt=""></div>` : ''}
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
