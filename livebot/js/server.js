/* Livebot — local dashboard server. Bound to 127.0.0.1 ONLY (never exposed to
 * a network), with a Host-header allowlist as DNS-rebinding hygiene. Serves the
 * static Pulse-style page and a JSON state endpoint; POST /api/panic triggers
 * the kill switch. No framework. */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
const ALLOW_HOST = /^(127\.0\.0\.1|localhost)(:\d+)?$/;

function startServer(opts) {
  const cfg = opts.cfg.SERVER;
  const getState = opts.getState;
  const onPanic = opts.onPanic || (() => {});

  const server = http.createServer((req, res) => {
    // Reject requests that didn't come through localhost (rebinding guard).
    const host = req.headers.host || '';
    if (!ALLOW_HOST.test(host)) { res.writeHead(403); res.end('forbidden'); return; }

    if (req.method === 'GET' && req.url === '/api/state') {
      return sendJSON(res, 200, getState());
    }
    if (req.method === 'POST' && req.url === '/api/panic') {
      onPanic();
      return sendJSON(res, 200, { ok: true });
    }
    if (req.method === 'GET') return serveStatic(req, res);
    res.writeHead(404); res.end('not found');
  });

  server.listen(cfg.port, cfg.host, () => {
    console.log('Dashboard: http://' + cfg.host + ':' + cfg.port);
  });
  return server;
}

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(body);
}

function serveStatic(req, res) {
  const rel = req.url === '/' ? 'index.html' : req.url.replace(/^\/+/, '').split('?')[0];
  const file = path.join(PUBLIC, rel);
  // path-traversal guard: resolved file must stay under PUBLIC
  if (!file.startsWith(PUBLIC + path.sep) && file !== path.join(PUBLIC, 'index.html')) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

module.exports = { startServer };
