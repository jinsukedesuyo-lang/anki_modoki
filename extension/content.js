// 動画ページ側: 選択中の単語・字幕の文・動画の位置を集める
// Language Reactor の DOM は非公開なので、特定のクラス名に頼りすぎず
// 「選択範囲を含むブロック要素のテキスト」→「既知の字幕要素」の順で探す。
(() => {
  if (window.__ankiModokiLoaded) return;
  window.__ankiModokiLoaded = true;

  const SUBTITLE_SELECTORS = [
    // Language Reactor（バージョンにより変わる可能性あり）
    '#lln-subs',
    '.lln-subs',
    '[class*="lln-sub"]',
    // YouTube 標準字幕
    '.ytp-caption-window-container',
    // Netflix 標準字幕
    '.player-timedtext-text-container',
    '.player-timedtext',
  ];

  const hasLatin = (s) => /[A-Za-z]{2,}/.test(s);
  const looksEnglish = (s) => {
    const latin = (s.match(/[A-Za-z]/g) || []).length;
    const cjk = (s.match(/[぀-ヿ一-鿿]/g) || []).length;
    return latin > 0 && latin >= cjk * 2;
  };
  const clean = (s) => s.replace(/\s+/g, ' ').trim();

  function isBlock(el) {
    const d = getComputedStyle(el).display;
    return !d.startsWith('inline') && d !== 'contents';
  }

  // 選択範囲を含む「1行ぶん」のテキストを取り出す
  function sentenceFromSelection(sel, word) {
    let el = sel.getRangeAt(0).commonAncestorContainer;
    if (el.nodeType === Node.TEXT_NODE) el = el.parentElement;
    while (el && el !== document.body) {
      const text = clean(el.innerText || '');
      if (isBlock(el) && text.split(' ').length >= 3) break;
      if (text.length > 600) break;
      el = el.parentElement;
    }
    if (!el || el === document.body) return '';
    const lines = (el.innerText || '').split('\n').map(clean).filter(Boolean);
    const lw = word.toLowerCase();
    const line = lines.find((l) => l.toLowerCase().includes(lw)) || '';
    return line.length > 400 ? '' : line;
  }

  function currentSubtitle() {
    for (const sel of SUBTITLE_SELECTORS) {
      for (const el of document.querySelectorAll(sel)) {
        if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') continue;
        const lines = (el.innerText || '').split('\n').map(clean).filter((l) => hasLatin(l) && looksEnglish(l));
        if (lines.length) return lines.join(' ');
      }
    }
    return '';
  }

  function mainVideo() {
    const vids = [...document.querySelectorAll('video')]
      .map((v) => ({ v, r: v.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 100 && r.height > 60);
    vids.sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height);
    return vids[0]?.v ?? null;
  }

  function sourceUrl(time) {
    const u = new URL(location.href);
    if (time == null) return u.href;
    if (u.hostname.endsWith('youtube.com') && u.searchParams.has('v')) {
      return `https://www.youtube.com/watch?v=${u.searchParams.get('v')}&t=${Math.floor(time)}s`;
    }
    if (u.hostname.endsWith('netflix.com')) u.searchParams.set('t', String(Math.floor(time)));
    return u.href;
  }

  function collect() {
    const sel = window.getSelection();
    const word = clean(sel?.toString() || '');
    let sentence = '';
    if (word && word.length < 60 && sel.rangeCount) sentence = sentenceFromSelection(sel, word);
    if (!sentence) sentence = currentSubtitle();
    if (!sentence && word.length >= 60) sentence = word; // 文ごと選択された場合

    const video = mainVideo();
    let rect = null;
    let time = null;
    if (video) {
      if (!video.paused) video.pause();
      time = video.currentTime;
      const r = video.getBoundingClientRect();
      const x = Math.max(0, r.left);
      const y = Math.max(0, r.top);
      rect = {
        x,
        y,
        w: Math.min(window.innerWidth, r.right) - x,
        h: Math.min(window.innerHeight, r.bottom) - y,
      };
    }
    return {
      word: word.length < 60 ? word : '',
      sentence,
      rect,
      dpr: window.devicePixelRatio || 1,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      source: {
        title: document.title.replace(/^\(\d+\)\s*/, '').replace(/\s*[-|]\s*(YouTube|Netflix)\s*$/i, ''),
        url: sourceUrl(time),
        time,
      },
    };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'anki-modoki:collect') sendResponse(collect());
  });
})();
