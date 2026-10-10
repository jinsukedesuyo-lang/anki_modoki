// オフライン対応: アプリ本体はネット優先（更新をすぐ反映）、画像とライブラリはキャッシュ優先
const SHELL = 'shell-v3';
const RUNTIME = 'runtime-v1';
const SHELL_FILES = [
  './',
  'index.html',
  'style.css',
  'config.js',
  'manifest.webmanifest',
  'js/app.js',
  'js/data.js',
  'js/editor.js',
  'js/lib.js',
  'js/srs.js',
  'js/icons.js',
  'js/practice.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== RUNTIME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Supabase Storage の署名付き画像URL: トークン部分(?token=)を無視してキャッシュ
  if (url.pathname.includes('/storage/v1/object/sign/')) {
    e.respondWith(cacheFirst(req, { ignoreSearch: true }));
    return;
  }
  // CDN のライブラリ（supabase-js）と Web フォント
  if (['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) {
    e.respondWith(cacheFirst(req));
    return;
  }
  // 自サイトのファイル
  if (url.origin === self.location.origin) {
    e.respondWith(networkFirst(req));
  }
  // それ以外（Supabase API・辞書など）は素通し
});

async function cacheFirst(req, matchOpts) {
  const cache = await caches.open(RUNTIME);
  const hit = await cache.match(req, matchOpts);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req, { ignoreSearch: true })) || (await cache.match('index.html'));
  }
}
