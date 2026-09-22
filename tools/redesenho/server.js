'use strict';
// Prévia do renderer real com uma ponte simulada. Nunca carrega main.js.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../..');
const RENDERER = path.join(ROOT, 'src/renderer');
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.woff2':'font/woff2' };
const { PORT: port, identity } = require('./qa-environment.cjs');
if (process.env.COCKPIT_QA_PORT && Number(process.env.COCKPIT_QA_PORT) !== port) throw new Error('Esta prévia usa exclusivamente a porta local 4319.');
function inside(base, file) { const relative = path.relative(base, file); return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); }
const server = http.createServer((req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    const url = new URL(req.url, 'http://127.0.0.1');
    const decoded = decodeURIComponent(url.pathname);
    if (decoded === '/__qa/identity') {
      res.writeHead(200, { 'Content-Type':'application/json', 'Cache-Control':'no-store', 'X-Cockpit-QA':'simulado-sem-motores' });
      return res.end(JSON.stringify(identity()));
    }
    if (decoded === '/favicon.ico') { res.writeHead(204); return res.end(); }
    const qa = decoded.startsWith('/__qa/');
    const base = qa ? __dirname : RENDERER;
    const relative = qa ? decoded.slice(6) : decoded.slice(1) || 'index.html';
    const file = path.resolve(base, relative);
    if (!inside(base, file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('Não encontrado'); }
    let data = fs.readFileSync(file);
    if (file === path.join(RENDERER, 'index.html')) {
      data = Buffer.from(data.toString('utf8')
        .replace('<head>', '<head>\n<script>window.__qaIdentity=' + JSON.stringify(identity()) + '</script><script src="/__qa/mock-api.js"></script>')
        .replace('</body>', '<script src="/__qa/fixtures.js"></script>\n</body>'));
    }
    res.writeHead(200, { 'Content-Type':MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store', 'X-Cockpit-QA':'simulado-sem-motores', 'X-Content-Type-Options':'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch (error) { res.writeHead(500, {'Content-Type':'text/plain'}); res.end(String(error.message)); }
});
server.listen(port, '127.0.0.1', () => process.stdout.write(`QA isolado: http://127.0.0.1:${port}\n`));
process.on('SIGINT', () => server.close());
process.on('SIGTERM', () => server.close());
module.exports = { inside };
