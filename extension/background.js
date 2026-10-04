// 拡張機能の本体: 情報収集 → スクショ → Ankiもどき の「追加」画面へ受け渡し
const MAX_WIDTH = 960;

chrome.runtime.onInstalled.addListener(async (details) => {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: 'anki-modoki-capture',
    title: 'Ankiもどきでカード作成',
    contexts: ['selection', 'page', 'video'],
  });
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === 'capture') capture(tab ?? (await activeTab()));
});
chrome.contextMenus.onClicked.addListener((_info, tab) => capture(tab));
chrome.action.onClicked.addListener((tab) => capture(tab));

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function notify(tabId, message) {
  // 簡易通知: バッジに表示
  chrome.action.setBadgeBackgroundColor({ color: '#cf222e' });
  chrome.action.setBadgeText({ tabId, text: '!' });
  chrome.action.setTitle({ tabId, title: `Ankiもどき: ${message}` });
  setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }), 4000);
  console.warn(message);
}

async function capture(tab) {
  if (!tab?.id) return;
  const { appUrl } = await chrome.storage.sync.get('appUrl');
  if (!appUrl) {
    chrome.runtime.openOptionsPage();
    return;
  }

  // 1. ページから単語・字幕・動画位置を集める（未注入のサイトでは注入してから）
  let info;
  try {
    info = await chrome.tabs.sendMessage(tab.id, { type: 'anki-modoki:collect' });
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      info = await chrome.tabs.sendMessage(tab.id, { type: 'anki-modoki:collect' });
    } catch (e) {
      info = { word: '', sentence: '', rect: null, source: { title: tab.title, url: tab.url } };
    }
  }

  // 2. 画面をキャプチャして動画部分だけ切り抜く
  let image = null;
  try {
    const shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    image = await crop(shot, info.rect, info.viewport);
  } catch (e) {
    notify(tab.id, `スクリーンショットを撮れませんでした: ${e.message}`);
  }

  // 3. Ankiもどき を開いて受け渡す
  await handOff(appUrl, { sentence: info.sentence, word: info.word, image, source: info.source });
}

async function crop(dataUrl, rect, viewport) {
  const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
  // キャプチャ画像と CSS ピクセルの比率（devicePixelRatio とズームを吸収）
  const scale = viewport ? bmp.width / viewport.w : 1;
  let sx = 0, sy = 0, sw = bmp.width, sh = bmp.height;
  if (rect && rect.w > 0 && rect.h > 0) {
    sx = Math.round(rect.x * scale);
    sy = Math.round(rect.y * scale);
    sw = Math.min(bmp.width - sx, Math.round(rect.w * scale));
    sh = Math.min(bmp.height - sy, Math.round(rect.h * scale));
  }
  const k = Math.min(1, MAX_WIDTH / sw);
  const canvas = new OffscreenCanvas(Math.round(sw * k), Math.round(sh * k));
  canvas.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/jpeg;base64,${btoa(bin)}`;
}

async function handOff(appUrl, payload) {
  const base = appUrl.replace(/#.*$/, '').replace(/\/?$/, '/');
  const tabs = await chrome.tabs.query({});
  let tab = tabs.find((t) => t.url && t.url.startsWith(base));

  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    if (tab.status !== 'complete') await waitForLoad(tab.id);
  } else {
    tab = await chrome.tabs.create({ url: `${base}#/new` });
    await waitForLoad(tab.id);
  }

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    func: (detail) => {
      window.__ankiCapture = detail;
      window.dispatchEvent(new CustomEvent('anki-capture', { detail }));
    },
    args: [payload],
  });
}

function waitForLoad(tabId) {
  return new Promise((resolve) => {
    const listener = (id, change) => {
      if (id === tabId && change.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 15000);
  });
}
