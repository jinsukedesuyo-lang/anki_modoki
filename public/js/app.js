import * as data from './data.js';
import { previewLabel, DEFAULT_SETTINGS, dayStart } from './srs.js';
import { buildPracticePrompt, MODES } from './practice.js';
import { sanitizeSentence, escapeHtml, stripHtml, parseDelimited, highlightWord, englishMeaning } from './lib.js';
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
  if (srs.state === 'new') return 'New';
  if (srs.state !== 'review') return 'Learning';
  const days = Math.ceil((srs.due - Date.now()) / 86400000);
  return days <= 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`;
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
      <div class="sub">${englishMeaning(c) ? `${escapeHtml(englishMeaning(c))} · ` : ''}${escapeHtml(stripHtml(c.sentence))}</div>
    </div>
  </a>`;
}

function renderShell() {
  document.getElementById('brand').innerHTML = `${brandMark}<span>Anki Modoki</span>`;
  const items = [
    ['', 'home', 'Home'],
    ['review', 'play', 'Review'],
    ['new', 'add', 'Add'],
    ['browse', 'library', 'Cards'],
    ['settings', 'tune', 'Settings'],
  ];
  document.getElementById('nav').innerHTML = items
    .map(([r, ic, label]) => `<a href="#/${r}" data-route="${r}" class="${r === 'new' ? 'add' : ''}">${icon(ic)}<span>${label}</span></a>`)
    .join('');
}

function renderStatus() {
  const end = document.getElementById('mastheadEnd');
  const pending = data.pendingCount();
  end.innerHTML = !navigator.onLine
    ? `<span class="meta row" title="Offline">${icon('offline', 18)}Offline</span>`
    : pending
      ? `<span class="meta row" title="Answers waiting to sync">${icon('sync', 18)}${pending} to sync</span>`
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
    view.innerHTML = `<div class="empty"><p>Couldn't load this page: ${escapeHtml(e.message)}</p>
      <button class="btn" onclick="location.reload()">${icon('replay')}Reload</button></div>`;
  }
}

function setupNeeded() {
  view.innerHTML = `<div class="center-page"><div class="login">
    <div class="brand">${brandMark}<span>Anki Modoki</span></div>
    <h1>Setup needed</h1>
    <p class="meta" style="font-size:14px">Put your Supabase Project URL and anon key in <code>public/config.js</code>. See README.md for the steps.</p>
  </div></div>`;
}

function login() {
  view.innerHTML = `<div class="center-page"><form class="login" id="f">
    <div class="brand">${brandMark}<span>Anki Modoki</span></div>
    <label class="field"><span class="label">Email</span><input type="email" id="email" autocomplete="username" required></label>
    <label class="field"><span class="label">Password</span><input type="password" id="pw" autocomplete="current-password" required></label>
    <button class="btn primary lg">Log in</button>
  </form></div>`;
  view.querySelector('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await data.signIn(view.querySelector('#email').value, view.querySelector('#pw').value);
      await data.loadSettings();
      location.hash = '#/';
    } catch (err) {
      toast(`Couldn't log in: ${err.message}`);
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
      <a class="player ${cover ? '' : 'blank'}" href="#/review" aria-label="Start review">
        ${cover ? `<img src="${escapeHtml(signed(cover.image))}" alt="">` : ''}
        ${total ? `<span class="playbtn">${icon('play')}</span>` : caption('All done for today')}
      </a>
      <h1 class="watch-title">${total ? `Today's review · ${total} left` : 'Great work today'}</h1>
      <div class="watch-meta">
        <span class="n">New <b>${n}</b></span>·<span class="l">Learning <b>${l}</b></span>·<span class="r">Review <b>${r}</b></span>
      </div>
      ${data.pendingCount() ? `<div class="notice">${icon('sync')}${data.pendingCount()} answers waiting. They sync automatically when you're online.</div>` : ''}
      ${navigator.onLine ? '' : `<div class="notice">${icon('offline')}You're offline. You can still review the cards loaded last time.</div>`}
      <div class="chips wrap" style="margin-top:12px">
        <a class="chip" href="#/new">${icon('add', 18)}Add a card</a>
        <a class="chip" href="#/practice">${icon('chat', 18)}Practice speaking</a>
        <a class="chip" href="#/import">${icon('upload', 18)}Import CSV</a>
        <a class="chip" href="#/usage">${icon('chart', 18)}AI costs</a>
      </div>
    </section>
    <h2>Recently added</h2>
    <div class="grid" id="recent"></div>`;

  try {
    const { cards: recent } = await data.listCards('', 0, 8);
    const s = await data.signUrls(recent.map((c) => c.image));
    view.querySelector('#recent').innerHTML = recent.length
      ? recent.map((c) => tile(c, s)).join('')
      : '<p class="meta">No cards yet. Select an unknown word on YouTube and press Alt+A, or tap Add.</p>';
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
  // 表面でもスクショを見せて、情景とセリフを結びつける（初期値オン。端末ごとに保存）
  let sceneOnFront = localStorage.getItem('am:sceneFront') !== 'off';

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
      const t = new Date(later.srs.due).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      screen('Take a break', `<h1 class="watch-title">The next card comes back around ${t}</h1>
        <div class="watch-meta">Keep this page open and it will continue automatically.</div>
        <div class="chips"><a class="chip" href="#/">${icon('home', 18)}Home</a></div>`);
      waitTimer = setTimeout(render, Math.min(60000, Math.max(1000, later.srs.due - LEARN_AHEAD - Date.now())));
      return;
    }
    screen('All done for today', `<h1 class="watch-title">You answered ${answered} card${answered === 1 ? '' : 's'}</h1>
      <div class="chips"><a class="chip" href="#/">${icon('home', 18)}Home</a><a class="chip active" href="#/practice">${icon('chat', 18)}Practice speaking</a><a class="chip" href="#/new">${icon('add', 18)}Add a card</a></div>`);
  }

  function draw() {
    const c = current;
    const now = Date.now();
    const rest = remaining();
    const pct = Math.round((answered / (answered + rest.length || 1)) * 100);
    const showImg = c.image && (showing || sceneOnFront);
    const src = c.source?.url ? `<a class="chip" href="${escapeHtml(c.source.url)}" target="_blank" rel="noopener">${icon('open', 18)}Original video</a>` : '';

    view.innerHTML = `<div class="watch">
      <div class="player ${showImg ? '' : 'blank'} ${ccOn ? '' : 'cc-off'}" id="player">
        ${showImg ? `<img src="${escapeHtml(signed(c.image))}" alt="">` : ''}
        ${caption(c.sentence)}
        <div class="progress"><i style="width:${pct}%"></i></div>
      </div>
      ${showing
        ? `<h1 class="watch-title">${escapeHtml(englishMeaning(c)) || `<span class="meta">No English meaning yet — <a class="link" href="#/edit/${c.id}">add one</a></span>`}</h1>`
        : '<h1 class="watch-title pending">Recall the meaning and the scene, then tap Show answer</h1>'}
      <div class="watch-meta">
        <span>${escapeHtml(c.word)}</span>${c.word ? '·' : ''}<span>${stateLabel(c.srs)}</span>
        <span class="spacer"></span>
        <span class="n"><b>${rest.filter((x) => x.srs.state === 'new').length}</b></span>
        <span class="l"><b>${rest.filter((x) => isLearning(x) && x.srs.due <= now + LEARN_AHEAD).length}</b></span>
        <span class="r"><b>${rest.filter((x) => x.srs.state === 'review').length}</b></span>
      </div>
      <div class="chips">
        <button class="chip" id="speak">${icon('volume', 18)}Listen</button>
        ${!showing && c.image ? `<button class="chip ${sceneOnFront ? 'active' : ''}" id="scene">${icon('image', 18)}Scene on front</button>` : ''}
        ${showing ? `<button class="chip ${ccOn ? 'active' : ''}" id="cc">${icon('cc', 18)}Captions</button>${src}<a class="chip" href="#/edit/${c.id}">${icon('edit', 18)}Edit</a>` : ''}
      </div>
      ${showing && (c.refImage || c.imagery?.core_image_en)
        ? `<div class="desc">
            <div class="head">${c.imagery?.core_image_en ? 'How natives picture it' : 'Image'}</div>
            ${c.imagery?.core_image_en ? `<div style="font-size:15px;margin-bottom:4px">${escapeHtml(c.imagery.core_image_en)}</div>` : ''}
            ${c.imagery?.scene_en ? `<div class="meta" style="font-size:13px;margin-bottom:8px">${escapeHtml(c.imagery.scene_en)}</div>` : ''}
            ${c.refImage ? `<img src="${escapeHtml(signed(c.refImage))}" alt="">` : ''}
          </div>`
        : ''}
      ${showing && c.source?.title ? `<div class="meta" style="margin-top:12px">${escapeHtml(c.source.title)}</div>` : ''}
    </div>
    <div class="answer-bar"><div class="inner">
      ${showing
        ? `<button class="btn" id="again">Again <small>${previewLabel(c.id, c.srs, 'again', now, settings)} <span class="kbd">· 1</span></small></button>
           <button class="btn primary" id="good">Good <small>${previewLabel(c.id, c.srs, 'good', now, settings)} <span class="kbd">· Space</span></small></button>`
        : '<button class="btn primary" id="show">Show answer <small class="kbd">Space</small></button>'}
    </div></div>`;

    view.querySelector('#show')?.addEventListener('click', flip);
    view.querySelector('#again')?.addEventListener('click', () => rate('again'));
    view.querySelector('#good')?.addEventListener('click', () => rate('good'));
    view.querySelector('#speak').addEventListener('click', () => speak(c));
    view.querySelector('#scene')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sceneOnFront = !sceneOnFront;
      localStorage.setItem('am:sceneFront', sceneOnFront ? 'on' : 'off');
      draw();
    });
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
        <input type="search" id="q" placeholder="Search words, sentences, meanings" enterkeyhint="search">
        <button class="go" aria-label="Search">${icon('search')}</button>
      </form>
    </div>
    <div class="chips" id="filters">
      <button class="chip active" data-state="">All</button>
      <button class="chip" data-state="new">New</button>
      <button class="chip" data-state="learning">Learning</button>
      <button class="chip" data-state="review">Review</button>
    </div>
    <div class="meta" id="total" style="margin-bottom:12px"></div>
    <div class="grid" id="list"></div>
    <div class="row" style="justify-content:center;margin-top:24px"><button class="btn" id="more" hidden>Show more</button></div>`;
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
    view.querySelector('#total').textContent = `${total} card${total === 1 ? '' : 's'}`;
    view.querySelector('#more').hidden = offset >= total;
    if (!total) list.innerHTML = '<p class="meta">No matching cards</p>';
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
    <h1>Import CSV / TSV</h1>
    <p class="meta" style="font-size:14px">Import saved words exported from Language Reactor and similar tools. Images aren't imported; you can add them later by editing each card.</p>
    <label class="btn" style="margin:8px 0 16px">${icon('upload')}Choose a file
      <input type="file" id="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" hidden></label>
    <div id="mapping"></div>
  </div>`;
  view.querySelector('#file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const rows = parseDelimited(await file.text());
    if (!rows.length) return toast('No data found in this file');
    const width = Math.max(...rows.map((r) => r.length));
    const guess = (re) => rows[0].findIndex((h) => re.test(h));
    const guessed = {
      sentence: guess(/sentence|subtitle|context|example|文|字幕/i), // ALLOW_JA: 日本語見出しの CSV も読む
      word: guess(/^(word|term|lemma|phrase|単語)/i), // ALLOW_JA
      meaning: guess(/meaning|translation|definition|意味|訳/i), // ALLOW_JA
    };
    const opts = (sel) =>
      `<option value="-1">(don't use)</option>` +
      Array.from({ length: width }, (_, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>Column ${i + 1}: ${escapeHtml((rows[0][i] || '').slice(0, 30))}</option>`).join('');
    const box = view.querySelector('#mapping');
    box.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:12px">
        <label class="row"><input type="checkbox" id="header" ${Object.values(guessed).some((i) => i >= 0) ? 'checked' : ''}> First row is a header</label>
        <label class="field"><span class="label">Sentence (required)</span><select id="m-sentence">${opts(guessed.sentence)}</select></label>
        <label class="field"><span class="label">Word (highlighted in the sentence)</span><select id="m-word">${opts(guessed.word)}</select></label>
        <label class="field"><span class="label">Meaning (English)</span><select id="m-meaning">${opts(guessed.meaning)}</select></label>
        <div id="pv"></div>
        <div><button class="btn primary" id="go">Import</button></div>
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
      box.querySelector('#pv').innerHTML = `<div class="meta">${items.length} rows (preview of the first 5)</div>
        <table class="preview"><tr><th>Sentence</th><th>Meaning</th></tr>${items
          .slice(0, 5)
          .map((r) => `<tr><td>${sanitizeSentence(r.sentence)}</td><td>${escapeHtml(englishMeaning(r))}</td></tr>`)
          .join('')}</table>`;
    };
    box.onchange = preview; // ファイルを選び直しても二重登録しない
    preview();
    box.querySelector('#go').addEventListener('click', async (ev) => {
      const items = build();
      if (!items.length) return toast('Nothing to import');
      ev.target.disabled = true;
      try {
        const n = await data.importCards(items, (done, all) => (ev.target.textContent = `Importing… ${done}/${all}`));
        toast(`Imported ${n} cards`);
        location.hash = '#/browse';
      } catch (err) {
        toast(`Import failed: ${err.message}`);
        ev.target.disabled = false;
        ev.target.textContent = 'Import';
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
    view.innerHTML = `<div class="empty"><h1>Practice speaking</h1><p>You haven't reviewed any cards yet. Review a few first, then come back.</p>
      <a class="btn" href="#/review">${icon('play')}Go to review</a></div>`;
    return;
  }
  const todayIds = new Set(logs.filter((l) => l.ts >= ds).map((l) => l.card_id));
  const againIds = new Set(logs.filter((l) => l.rating === 'again').map((l) => l.card_id));
  const groups = {
    today: { label: 'Reviewed today', cards: studied.filter((c) => todayIds.has(c.id)) },
    weak: {
      label: 'Missed / weak',
      cards: studied
        .filter((c) => againIds.has(c.id) || c.srs.lapses > 0 || c.srs.state === 'relearning')
        .sort((a, b) => (b.srs.lapses || 0) - (a.srs.lapses || 0)),
    },
    recent: { label: 'Learned this week', cards: studied.filter((c) => Date.now() - new Date(c.created).getTime() < 7 * 864e5) },
    all: { label: 'All', cards: studied },
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
    <h1>Practice speaking</h1>
    <p class="meta" style="font-size:14px">Build a prompt for ChatGPT, Claude or Gemini so you <b>say the expressions yourself</b> in a real conversation. Aim for 5–8 expressions, about 15 minutes.</p>

    <div class="sub-label" style="margin-top:20px">Expressions</div>
    <div class="chips" id="groups"></div>
    <div class="pick-list" id="picks"></div>

    <div class="sub-label" style="margin-top:20px">Practice style</div>
    <div class="chips" id="modes"></div>
    <div class="meta" id="modeHint" style="margin:-4px 0 12px"></div>
    <div class="row" style="gap:16px">
      <label class="field" style="flex:1;min-width:200px"><span class="label">Your English level</span>
        <select id="level"><option value="A2">A2 (simple)</option><option value="B1">B1 (everyday conversation)</option><option value="B2">B2 (natural speed)</option></select></label>
      <label class="row"><input type="checkbox" id="voice"> I'll talk by voice</label>
    </div>

    <div class="sub-label" style="margin-top:20px">Prompt <span class="meta" id="pcount"></span></div>
    <textarea id="out" readonly rows="12" class="prompt-out"></textarea>
    <div class="actions" style="margin-top:12px">
      <button class="btn primary" id="copy">${icon('copy')}Copy</button>
      <button class="btn" id="chatgpt">${icon('open')}Open in ChatGPT</button>
      <button class="btn" id="claude">${icon('open')}Open in Claude</button>
      <button class="btn" id="gemini">${icon('open')}Open in Gemini</button>
      <button class="btn ghost" id="save">${icon('download')}Save as text</button>
    </div>
    <div class="desc" style="margin-top:16px;font-size:13px;line-height:1.8">
      <div class="head">Tips</div>
      • To talk by voice, turn on "I'll talk by voice", paste the prompt into the ChatGPT or Gemini app, then switch to voice mode<br>
      • Stuck? Say <b>I don't understand</b> and you'll get the answer right away<br>
      • Can't make a sentence? Say <b>I can't make a sentence</b> and you'll get an example<br>
      • When you get a correction, <b>say the better version out loud</b> before moving on<br>
      • Say <b>finish</b> at the end for a short report (◎ on your own / △ after a hint / × not yet). Keep the × ones in mind during your next review
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
        <span class="w">${escapeHtml(c.word || stripHtml(c.sentence))}</span><span class="meta">${escapeHtml(englishMeaning(c))}</span></label>`)
      .join('');
    $('#modes').innerHTML = Object.entries(MODES)
      .map(([k, m]) => `<button class="chip ${k === st.mode ? 'active' : ''}" data-m="${k}">${m.label}</button>`)
      .join('');
    $('#modeHint').textContent = MODES[st.mode].hint;
    const cards = selectedCards();
    $('#pcount').textContent = `— ${cards.length} expression${cards.length === 1 ? '' : 's'}${cards.length > 8 ? ' (with too many, each one gets less practice; 5–8 is best)' : ''}`;
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
      toast('Choose at least one expression');
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
    toast(`Opened ${name}. If the message box is empty, paste the prompt (Ctrl+V).`);
  }
  $('#copy').addEventListener('click', async () => {
    if (await copy()) toast('Copied. Paste it into your AI chat and send it.');
  });
  $('#chatgpt').addEventListener('click', () => openWith(`https://chatgpt.com/?q=${encodeURIComponent($('#out').value)}`, 'ChatGPT'));
  $('#claude').addEventListener('click', () => openWith(`https://claude.ai/new?q=${encodeURIComponent($('#out').value)}`, 'Claude'));
  $('#gemini').addEventListener('click', () => openWith('https://gemini.google.com/app', 'Gemini'));
  $('#save').addEventListener('click', () => {
    const text = $('#out').value;
    if (!text) return toast('Choose at least one expression');
    download(`speaking-practice_${new Date().toISOString().slice(0, 10)}.txt`, text, 'text/plain');
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
    return `¥${y.toLocaleString('en-US', { maximumFractionDigits: y < 10 ? 2 : 0 })}`;
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
  const stepName = { concept: 'Context analysis', image: 'Image' };
  let sim = { cards: 300, users: 100 };
  try {
    sim = { ...sim, ...JSON.parse(localStorage.getItem('am:sim') || '{}') };
  } catch {
    /* 壊れた保存値は無視 */
  }

  view.innerHTML = `<div style="max-width:960px">
    <h1>AI costs</h1>
    <div class="kpis">
      <div><span>This month</span><b>${yen(sum(month))}</b><small>${usd(sum(month))} · ${generations(month)} generations</small></div>
      <div><span>Per generation</span><b>${yen(unit)}</b><small>${perGen == null ? 'Estimate (no data yet)' : `${usd(unit)} · average of ${genAll}`}</small></div>
      <div><span>All time</span><b>${yen(sum(rows))}</b><small>${usd(sum(rows))} · ${rows.length} API calls</small></div>
    </div>

    <h2>Cost forecast for a product</h2>
    <div class="desc">
      <div class="form-grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
        <label class="field"><span class="label">Generations per user / month</span><input type="number" id="simCards" min="0" value="${sim.cards}"></label>
        <label class="field"><span class="label">Users</span><input type="number" id="simUsers" min="0" value="${sim.users}"></label>
        <label class="field"><span class="label">Exchange rate (JPY per USD)</span><input type="number" id="rate" min="1" step="0.1" value="${data.usdJpy()}"></label>
      </div>
      <div class="kpis" id="simOut" style="margin-top:12px"></div>
      <div class="meta" style="margin-top:8px">One generation = context analysis + one image. Uses your actual average cost, including failed calls.</div>
    </div>

    <h2>Breakdown</h2>
    ${Object.keys(groups).length
      ? `<div style="overflow-x:auto"><table class="preview">
        <tr><th>Step</th><th>Model</th><th>Calls</th><th>Avg input</th><th>Avg output (incl. thinking)</th><th>Avg image</th><th>Avg cost</th><th>Total</th></tr>
        ${Object.values(groups)
          .map((g) => `<tr><td>${stepName[g.step] ?? escapeHtml(g.step)}</td><td>${escapeHtml(g.model)}</td><td>${g.n}${g.fail ? ` (${g.fail} failed)` : ''}</td>
            <td>${Math.round(g.inp / g.n)}</td><td>${Math.round(g.out / g.n)}</td><td>${Math.round(g.img / g.n)}</td>
            <td>${usd(g.cost / g.n, 5)}</td><td>${usd(g.cost)}</td></tr>`)
          .join('')}
      </table></div>`
      : '<p class="meta">No AI usage yet. Use "Generate from context" on the card editor and it will show up here.</p>'}

    <h2>History <span class="meta">(latest 50)</span></h2>
    <div class="actions" style="margin-bottom:8px"><button class="btn sm" id="csv">${icon('download', 18)}Export all as CSV</button></div>
    <div style="overflow-x:auto"><table class="preview">
      <tr><th>Time</th><th>Word</th><th>Step</th><th>Tokens (in / out / image)</th><th>Cost</th><th>Result</th></tr>
      ${rows
        .slice(0, 50)
        .map((r) => `<tr><td>${new Date(r.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
          <td>${escapeHtml(r.word)}</td><td>${stepName[r.step] ?? escapeHtml(r.step)}</td>
          <td>${r.input_tokens} / ${r.output_tokens + r.thought_tokens} / ${r.image_tokens}</td>
          <td>${usd(Number(r.cost_usd), 5)}</td><td>${r.ok ? 'OK' : `<span class="meta" title="${escapeHtml(r.error || '')}">Failed</span>`}</td></tr>`)
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
    const fmt = (v) => `¥${Math.round(v * rate).toLocaleString('en-US')}`;
    $('#simOut').innerHTML = `
      <div><span>Per user / month</span><b>${fmt(perUser)}</b><small>$${perUser.toFixed(2)}</small></div>
      <div><span>All users / month</span><b>${fmt(perUser * users)}</b><small>$${(perUser * users).toFixed(2)}</small></div>
      <div><span>All users / year</span><b>${fmt(perUser * users * 12)}</b><small>$${(perUser * users * 12).toFixed(2)}</small></div>`;
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
    <h1>Settings</h1>
    <form id="f">
      <div class="form-grid">
        ${field('newPerDay', 'New cards per day')}
        ${field('dayStartHour', 'Day starts at (hour)')}
        ${field('learningSteps', 'Learning steps (minutes, space-separated)')}
        ${field('relearningSteps', 'Relearning steps after Again (minutes)')}
        ${field('graduatingInterval', 'Graduating interval (days)')}
        ${field('maxInterval', 'Maximum interval (days)')}
        ${field('startingEase', 'Starting ease')}
        ${field('lapseEasePenalty', 'Ease penalty on Again')}
      </div>
      <div class="actions" style="margin-top:16px">
        <button class="btn primary">Save</button>
        <button class="btn ghost" type="button" id="def">Reset to defaults</button>
      </div>
    </form>
    <div class="section">
      <h2>Account</h2>
      <div class="meta" style="font-size:14px">${escapeHtml(user?.email ?? '')}</div>
      <div class="meta">Answers waiting to sync: ${data.pendingCount()}</div>
      <div class="actions" style="margin-top:12px">
        <button class="btn" id="sync">${icon('sync')}Sync now</button>
        <button class="btn" id="import">${icon('upload')}Import CSV</button>
        <a class="btn" href="#/usage">${icon('chart')}AI costs</a>
        <a class="btn" href="#/practice">${icon('chat')}Practice speaking</a>
        <button class="btn ghost danger" id="logout">${icon('logout')}Log out</button>
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
    toast('Saved');
  });
  view.querySelector('#def').addEventListener('click', async () => {
    await data.saveSettings({});
    toast('Reset to defaults');
    settings();
  });
  view.querySelector('#import').addEventListener('click', () => (location.hash = '#/import'));
  view.querySelector('#sync').addEventListener('click', async () => {
    await data.flush();
    renderStatus();
    toast(data.pendingCount() ? `${data.pendingCount()} still waiting (are you offline?)` : 'Synced');
  });
  view.querySelector('#logout').addEventListener('click', async () => {
    if (data.pendingCount() && !confirm('Answers that haven\'t synced will be lost. Log out anyway?')) return;
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
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker registration failed', e));
}
