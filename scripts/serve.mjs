// Minimal static server for dist/, for local testing. localhost counts as a
// secure context, so the service worker and File System Access API work.
// Usage: node scripts/serve.mjs  (PORT defaults to 8080)

import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const port = Number(process.env.PORT) || 8080;

const TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  let file = path.join(root, path.normalize(urlPath));
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  try {
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    await stat(file);
  } catch {
    res.writeHead(404, {'Content-Type': 'text/plain'}).end('Not found');
    return;
  }
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  createReadStream(file).pipe(res);
}).listen(port, () => {
  console.log(`Serving dist/ at http://localhost:${port}/`);
});
