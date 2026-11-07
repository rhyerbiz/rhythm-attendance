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
  // Only files inside the repo (a sibling folder like ../rhythm-attendance-old must not match), never .git or clasp settings.
  if (!file.startsWith(ROOT + path.sep) || /[\\/]\.(git|clasp)/.test(file.slice(ROOT.length))) { res.writeHead(403); return res.end(); }
  const target = fs.existsSync(file) && fs.statSync(file).isDirectory() ? path.join(file, 'index.html') : file;
  fs.readFile(target, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': (TYPES[path.extname(target)] || 'application/octet-stream') + '; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(data);
  });
// This computer only: the repo holds deploy settings that aren't for the rest of the network.
}).listen(PORT, '127.0.0.1', () => console.log('Preview: http://localhost:' + PORT + '/'));
