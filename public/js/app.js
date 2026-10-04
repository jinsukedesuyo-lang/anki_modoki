import * as data from './data.js';
import { previewLabel, DEFAULT_SETTINGS } from './srs.js';
import { sanitizeSentence, escapeHtml, stripHtml, parseDelimited, highlightWord } from './lib.js';
import { renderEditor } from './editor.js';

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

function stateLabel(srs) {
  if (srs.state === 'new') return '新規';
  if (srs.state !== 'review') return '学習中';
  const days = Math.ceil((srs.due - Date.now()) / 86400000);
  return days <= 0 ? '今日' : `${days}日後`;
}

// ---------- 画面 ----------
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

  if (!data.configured) return setupNeeded();
  const user = await data.currentUser();
  if (seq !== routeSeq) return; // 待っている間に別の画面遷移が起きた
  if (!user && name !== 'login') {
    location.hash = '#/login';
    return;
  }
  document.getElementById('nav').hidden = !user;
  try {
    await (routes[name] || home)(arg);
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="panel"><p>読み込みに失敗しました: ${escapeHtml(e.message)}</p>
      <button class="btn" onclick="location.reload()">再読み込み</button></div>`;
  }
}

function setupNeeded() {
  document.getElementById('nav').hidden = true;
  view.innerHTML = `<div class="panel stack">
    <h1>初期設定が必要です</h1>
    <p><code>public/config.js</code> に Supabase の Project URL と anon key を設定してください。手順は README.md を参照。</p>
  </div>`;
}

function login() {
  view.innerHTML = `<form class="panel stack" id="f" style="max-width:420px;margin:40px auto">
    <h1>ログイン</h1>
    <label class="field"><span>メールアドレス</span><input type="email" id="email" autocomplete="username" required></label>
    <label class="field"><span>パスワード</span><input type="password" id="pw" autocomplete="current-password" required></label>
    <button class="btn primary" style="width:100%">ログイン</button>
    <p class="muted">ユーザーは Supabase の管理画面で作成します（README 参照）。</p>
  </form>`;
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

async function home() {
  view.innerHTML = '<p class="muted">読み込み中…</p>';
  await data.loadSettings().catch(() => {});
  const { cards, dayEnd } = await data.loadQueue();
  const n = cards.filter((c) => c.srs.state === 'new').length;
  const l = cards.filter((c) => c.srs.state === 'learning' || c.srs.state === 'relearning').length;
  const r = cards.filter((c) => c.srs.state === 'review' && c.srs.due < dayEnd).length;
  const pending = data.pendingCount();
  view.innerHTML = `
    <div class="panel stack">
      <h1>今日の学習</h1>
      <div class="counts">
        <div class="c-new"><b>${n}</b>新規</div>
        <div class="c-learn"><b>${l}</b>学習中</div>
        <div class="c-review"><b>${r}</b>復習</div>
      </div>
      <a class="btn primary" style="width:100%;padding:14px" href="#/review">${n + l + r ? '復習を始める' : '今日の分は完了 🎉'}</a>
      ${pending ? `<p class="muted">未送信の回答 ${pending} 件（オンラインになると自動で同期されます）</p>` : ''}
      ${navigator.onLine ? '' : '<p class="muted">オフラインです。前回読み込んだカードで復習できます。</p>'}
    </div>
    <div class="row" style="margin-top:12px">
      <a class="btn" href="#/new">＋ カードを追加</a>
      <a class="btn" href="#/import">CSV取り込み（Language Reactor）</a>
    </div>`;
}

async function review() {
  view.innerHTML = '<p class="muted">読み込み中…</p>';
  const { cards, settings, dayEnd } = await data.loadQueue();
  const signed = await data.signUrls(cards.flatMap((c) => [c.image, c.refImage]));
  const LEARN_AHEAD = 20 * 60 * 1000;
  let current = null;
  let showing = false;
  let answered = 0;
  let waitTimer = null;

  const isLearning = (c) => c.srs.state === 'learning' || c.srs.state === 'relearning';
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

  function counts() {
    const now = Date.now();
    const rest = remaining();
    return `<div class="bar">
      <span class="n">${rest.filter((c) => c.srs.state === 'new').length}</span>
      <span class="l">${rest.filter((c) => isLearning(c) && c.srs.due <= now + LEARN_AHEAD).length}</span>
      <span class="r">${rest.filter((c) => c.srs.state === 'review').length}</span>
    </div>`;
  }

  function imgs(c) {
    const parts = [];
    if (c.image) parts.push(`<img src="${escapeHtml(signed(c.image))}" alt="スクリーンショット">`);
    if (c.refImage) parts.push(`<img src="${escapeHtml(signed(c.refImage))}" alt="イメージ画像"><div class="label">語源 / イメージ</div>`);
    return parts.length ? `<div class="imgs">${parts.join('')}</div>` : '';
  }

  function speak(c) {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(stripHtml(c.sentence));
    u.lang = 'en-US';
    speechSynthesis.speak(u);
  }

  function render() {
    clearTimeout(waitTimer);
    current = pick();
    showing = false;
    if (!current) {
      const later = cards.filter(isLearning).sort((a, b) => a.srs.due - b.srs.due)[0];
      if (later) {
        const t = new Date(later.srs.due).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        view.innerHTML = `<div class="panel stack" style="text-align:center"><h1>ひと休み</h1>
          <p>次の学習中カードは <b>${t}</b> 頃に出題されます。</p><a class="btn" href="#/">ホームへ</a></div>`;
        waitTimer = setTimeout(render, Math.min(60000, Math.max(1000, later.srs.due - LEARN_AHEAD - Date.now())));
        return;
      }
      view.innerHTML = `<div class="panel stack" style="text-align:center"><h1>今日の分は完了 🎉</h1>
        <p>${answered} 枚回答しました。</p><a class="btn" href="#/">ホームへ</a></div>`;
      return;
    }
    draw();
  }

  function draw() {
    const c = current;
    const now = Date.now();
    view.innerHTML = `<div class="review">
      ${counts()}
      <div class="card" id="cardArea">
        <div class="sentence">${sanitizeSentence(c.sentence)}</div>
        ${showing ? `<hr>
          <div class="meaning">${escapeHtml(c.meaning) || '<span class="muted">（意味未入力）</span>'}</div>
          ${imgs(c)}
          <div class="src">
            ${c.source?.url ? `<a href="${escapeHtml(c.source.url)}" target="_blank" rel="noopener">${escapeHtml(c.source.title || '出典')}</a> · ` : ''}
            <button class="icon-btn" id="speak" title="読み上げ">🔊</button>
            <a href="#/edit/${c.id}" class="muted">編集</a>
          </div>` : ''}
      </div>
      <div class="answer-bar">
        ${showing
          ? `<button class="again" id="again">Again<small>${previewLabel(c.id, c.srs, 'again', now, settings)}</small></button>
             <button class="good" id="good">Good<small>${previewLabel(c.id, c.srs, 'good', now, settings)}</small></button>`
          : '<button class="show" id="show">答えを見る</button>'}
      </div>
    </div>`;
    view.querySelector('#show')?.addEventListener('click', flip);
    view.querySelector('#again')?.addEventListener('click', () => rate('again'));
    view.querySelector('#good')?.addEventListener('click', () => rate('good'));
    view.querySelector('#speak')?.addEventListener('click', () => speak(c));
    if (!showing) view.querySelector('#cardArea').addEventListener('click', flip);
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
    render();
  }

  function onKey(e) {
    if (e.target.closest('input, textarea, [contenteditable]')) return;
    if (!showing && (e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault();
      flip();
    } else if (showing && (e.key === '1')) {
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
    speechSynthesis?.cancel?.();
  };
  render();
}

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
  view.innerHTML = '<p class="muted">読み込み中…</p>';
  const card = await data.getCard(id);
  teardown = renderEditor(view, {
    card,
    toast,
    onSaved: () => history.back(),
    onDeleted: () => (location.hash = '#/browse'),
  });
}

async function browse() {
  view.innerHTML = `<h1>カード一覧</h1>
    <input type="search" id="q" placeholder="単語・文・意味で検索">
    <p class="muted" id="total"></p>
    <div class="list" id="list"></div>
    <button class="btn" id="more" hidden style="width:100%;margin-top:12px">もっと見る</button>`;
  const list = view.querySelector('#list');
  let q = '';
  let offset = 0;
  let timer;

  async function load(reset) {
    if (reset) {
      offset = 0;
      list.innerHTML = '';
    }
    const { total, cards } = await data.listCards(q, offset);
    const signed = await data.signUrls(cards.map((c) => c.image));
    offset += cards.length;
    view.querySelector('#total').textContent = `${total} 枚`;
    view.querySelector('#more').hidden = offset >= total;
    list.insertAdjacentHTML(
      'beforeend',
      cards
        .map(
          (c) => `<a class="item" href="#/edit/${c.id}">
            ${c.image ? `<img src="${escapeHtml(signed(c.image))}" alt="" loading="lazy">` : '<div class="noimg"></div>'}
            <div class="body"><div class="w">${escapeHtml(c.word || '—')} <span class="muted">${escapeHtml(c.meaning)}</span></div>
            <div class="s">${escapeHtml(stripHtml(c.sentence))}</div></div>
            <span class="badge">${stateLabel(c.srs)}</span></a>`
        )
        .join('')
    );
  }
  view.querySelector('#q').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      q = e.target.value.trim();
      load(true);
    }, 300);
  });
  view.querySelector('#more').addEventListener('click', () => load(false));
  await load(true);
}

// Language Reactor の「保存した単語」などを CSV/TSV で取り込む
function importView() {
  view.innerHTML = `<h1>CSV / TSV 取り込み</h1>
    <div class="panel stack">
      <p class="muted">Language Reactor の保存単語エクスポート（CSV / TSV）などを読み込めます。列の割り当てを選んでから取り込んでください。画像は取り込まれないので、必要なら後から一覧で追加してください。</p>
      <input type="file" id="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values">
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
      <label class="row"><input type="checkbox" id="header" ${Object.values(guessed).some((i) => i >= 0) ? 'checked' : ''}> 1行目は見出し</label>
      <label class="field"><span>センテンス（必須）</span><select id="m-sentence">${opts(guessed.sentence)}</select></label>
      <label class="field"><span>単語（センテンス内で自動ハイライト）</span><select id="m-word">${opts(guessed.word)}</select></label>
      <label class="field"><span>日本語の意味</span><select id="m-meaning">${opts(guessed.meaning)}</select></label>
      <div id="pv"></div>
      <button class="btn primary" id="go">取り込む</button>`;

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
      box.querySelector('#pv').innerHTML = `<p class="muted">${items.length} 件（先頭5件のプレビュー）</p>
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

async function settings() {
  const s = await data.loadSettings();
  const user = await data.currentUser();
  const field = (key, label, hint = '') =>
    `<label class="field"><span>${label}${hint ? `（${hint}）` : ''}</span>
      <input type="text" inputmode="decimal" id="s-${key}" value="${escapeHtml(Array.isArray(s[key]) ? s[key].join(' ') : s[key])}"></label>`;
  view.innerHTML = `<h1>設定</h1>
    <form class="panel stack" id="f">
      ${field('newPerDay', '1日の新規カード数')}
      ${field('learningSteps', '学習ステップ', '分・スペース区切り')}
      ${field('relearningSteps', 'Again 後の再学習ステップ', '分')}
      ${field('graduatingInterval', '卒業間隔', '日')}
      ${field('startingEase', '初期 Ease')}
      ${field('lapseEasePenalty', 'Again 時の Ease 減少')}
      ${field('maxInterval', '最大間隔', '日')}
      ${field('dayStartHour', '1日の区切り', '時')}
      <div class="row"><button class="btn primary">保存</button><button class="btn" type="button" id="def">初期値に戻す</button></div>
    </form>
    <div class="panel stack" style="margin-top:16px">
      <div>ログイン中: ${escapeHtml(user?.email ?? '')}</div>
      <div class="muted">未送信の回答: ${data.pendingCount()} 件</div>
      <div class="row"><button class="btn" id="sync">今すぐ同期</button><button class="btn danger" id="logout">ログアウト</button></div>
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
  view.querySelector('#sync').addEventListener('click', async () => {
    await data.flush();
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
