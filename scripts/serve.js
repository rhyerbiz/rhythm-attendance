// Local preview server. Run: node scripts/serve.js   then open http://localhost:8642/
// Serves the repo root so the page can load ../apps-script/Logic.gs in preview mode.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = +process.env.PORT || 8642;
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.gs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/') {
    res.writeHead(302, { Location: '/web/?t=static' });
    return res.end();
  }
  const file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  const target = fs.existsSync(file) && fs.statSync(file).isDirectory() ? path.join(file, 'index.html') : file;
  fs.readFile(target, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': (TYPES[path.extname(target)] || 'application/octet-stream') + '; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(PORT, () => console.log('Preview: http://localhost:' + PORT + '/'));
