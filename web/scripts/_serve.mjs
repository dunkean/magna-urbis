// Static frozen build with cross-origin isolation, for verification while others edit the sources.
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
const dist = resolve(process.argv[2]), port = Number(process.argv[3] ?? 5190);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (path === '/') path = '/v2.html';
  const file = normalize(join(dist, path));
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  try { if (!file.startsWith(dist) || !statSync(file).isFile()) throw 0; res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream'); createReadStream(file).pipe(res); }
  catch { res.statusCode = 404; res.end(); }
}).listen(port, '127.0.0.1', () => console.log('serving', dist, port));
