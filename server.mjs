import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { loadEnv } from './lib/env.mjs';
import { buildSnapshot } from './lib/kpis.mjs';

await loadEnv();

const root = process.cwd();
const contentType = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };

async function api(res, live = false) {
  if (!live) {
    try {
      const snapshot = JSON.parse(await readFile(join(root, 'data', 'cache.json'), 'utf8'));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(snapshot));
    } catch { /* No scheduled snapshot yet: fetch a live one below. */ }
  }
  try {
    const snapshot = await buildSnapshot();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(snapshot));
  } catch (error) {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/kpis') return api(res, url.searchParams.get('live') === '1');
  const requested = url.pathname === '/' ? 'index.html' : normalize(url.pathname).replace(/^[/\\]+/, '');
  const file = join(root, requested);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  try { await stat(file); res.writeHead(200, { 'Content-Type': contentType[extname(file)] || 'application/octet-stream' }); res.end(await readFile(file)); }
  catch { res.writeHead(404); res.end('Not found'); }
}).listen(4173, () => console.log('KPI dashboard: http://localhost:4173'));
