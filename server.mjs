import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = fileURLToPath(new URL('.', import.meta.url));
const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
export function securityHeaders(production = true, encoderWorker = false) {
  return {
    'Content-Security-Policy': `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'${encoderWorker ? " 'unsafe-eval'" : ''}${production ? '' : " 'nonce-shopreel-local-dev'"}; worker-src 'self' blob:; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self'${production ? '' : " 'nonce-shopreel-local-dev'"}; connect-src 'self'${production ? '' : ' ws://127.0.0.1:5050 ws://localhost:5050'}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`,
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
}
function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function serveFile(req, res, path, type) {
  if (!req.headers.range && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '') && existsSync(path + '.gz')) {
    res.setHeader('Content-Encoding', 'gzip'); res.setHeader('Vary', 'Accept-Encoding');
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': statSync(path + '.gz').size, 'Cache-Control': 'no-cache' });
    if (req.method === 'HEAD') res.end(); else createReadStream(path + '.gz').pipe(res);
    return;
  }
  const size = statSync(path).size;
  const range = req.headers.range;
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!match) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return; }
    const start = Number(match[1]), end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return; }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') res.end(); else createReadStream(path, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { ...headers, 'Content-Length': size });
    if (req.method === 'HEAD') res.end(); else createReadStream(path).pipe(res);
  }
}
export function localLibrary(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/legacy') && !url.pathname.startsWith('/legacy-media/')) return false;
  const host = new URL(`http://${req.headers.host ?? 'invalid'}`).hostname;
  if (process.env.NODE_ENV === 'production' || !loopback.has(host) || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')) {
    json(res, 403, { error: 'Legacy server files are accessible only on this computer, never in production.' }); return true;
  }
  if (!['GET', 'HEAD'].includes(req.method ?? '')) { json(res, 405, { error: 'Read-only library; uploads are never accepted.' }); return true; }
  if (url.pathname === '/api/legacy') {
    const path = resolve(root, 'data', 'studio.sqlite3');
    if (!existsSync(path)) { json(res, 200, { videos: [], projects: [] }); return true; }
    let db;
    try {
      db = new DatabaseSync(path, { readOnly: true });
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name);
      json(res, 200, {
        videos: tables.includes('videos') ? db.prepare('SELECT * FROM videos ORDER BY created_at DESC').all() : [],
        projects: tables.includes('projects') ? db.prepare('SELECT id,brief,plan,created_at FROM projects ORDER BY created_at DESC').all() : [],
      });
    } catch (error) {
      console.error('Cannot open read-only local library:', error instanceof Error ? error.message : 'unknown error');
      json(res, 503, { error: 'Existing library could not be read. Files are untouched; check the terminal.' });
    } finally { db?.close(); }
    return true;
  }
  const match = /^\/legacy-media\/([a-f0-9]{32})\/(video\.mp4|poster\.jpg|product\.png|subtitles\.srt)$/.exec(url.pathname);
  if (!match) { json(res, 404, { error: 'Media not found.' }); return true; }
  const path = resolve(root, 'outputs', match[1], match[2]);
  if (!existsSync(path)) { json(res, 404, { error: 'Media not found.' }); return true; }
  serveFile(req, res, path, { '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.png': 'image/png', '.srt': 'application/x-subrip' }[extname(path)]);
  return true;
}
export function startServer() {
  const publicDir = resolve(root, 'dist');
  if (!existsSync(resolve(publicDir, 'index.html'))) throw new Error('Production build missing. Run npm run build first.');
  const production = process.env.NODE_ENV === 'production';
  const allowed = new Set((process.env.SHOPREEL_ALLOWED_HOSTS ?? 'localhost,127.0.0.1,[::1]').split(',').map(x => x.trim()));
  const server = createServer((req, res) => {
    // The pinned Emscripten encoder generates binding functions inside its isolated worker.
    // Never allow dynamic JavaScript evaluation in the page itself.
    for (const [name, value] of Object.entries(securityHeaders(true, /^\/assets\/render\.worker-[\w-]+\.js(?:\?|$)/.test(req.url ?? '')))) res.setHeader(name, value);
    let url, host;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
      host = new URL(`http://${req.headers.host ?? 'invalid'}`).hostname;
    } catch { json(res, 400, { error: 'Invalid request.' }); return; }
    if (!allowed.has(host)) { json(res, 403, { error: 'Host not allowed. Configure the exact ShopReel domain.' }); return; }
    if (localLibrary(req, res)) return;
    if (!['GET', 'HEAD'].includes(req.method ?? '')) { json(res, 405, { error: 'This server only serves application assets. Rendering happens in your browser.' }); return; }
    if (url.pathname.startsWith('/api/')) { json(res, 404, { error: 'No rendering API.' }); return; }
    let decoded;
    try { decoded = decodeURIComponent(url.pathname); } catch { json(res, 400, { error: 'Invalid path.' }); return; }
    const path = resolve(publicDir, '.' + decoded);
    if (!path.startsWith(publicDir + sep) && path !== publicDir) { json(res, 403, { error: 'Invalid path.' }); return; }
    const actual = decoded === '/' ? resolve(publicDir, 'index.html') : path;
    if (!existsSync(actual) || !statSync(actual).isFile()) { json(res, 404, { error: 'Asset not found.' }); return; }
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8' };
    serveFile(req, res, actual, types[extname(actual)] ?? 'application/octet-stream');
  });
  const port = Number(process.env.PORT ?? 5050);
  server.listen(port, production ? '0.0.0.0' : '127.0.0.1', () => console.log(`ShopReel browser studio listening on port ${port}; encoding is client-side.`));
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startServer();
