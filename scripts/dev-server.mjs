// ローカル確認用の静的サーバー（npm run dev → http://localhost:8080/）
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve('public');
const PORT = Number(process.env.PORT || 8080);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

http
  .createServer(async (req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT)) return res.writeHead(403).end();
    try {
      if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404).end('Not found');
    }
  })
  .listen(PORT, () => console.log(`http://localhost:${PORT}/`));
