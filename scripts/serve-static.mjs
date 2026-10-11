// Serve the static export under its GitHub Pages base path, for end-to-end tests.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = new URL('../out/', import.meta.url).pathname;
const base = process.env.PAGES_BASE_PATH ?? '/chat-fault-lab';
const port = Number(process.env.PORT ?? 3418);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.txt': 'text/plain', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (!url.pathname.startsWith(base)) {
    res.writeHead(404).end('not under base path');
    return;
  }
  let rel = normalize(decodeURIComponent(url.pathname.slice(base.length)) || '/');
  if (rel.includes('..')) return void res.writeHead(400).end();
  let file = join(root, rel);
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  } catch {
    file = join(root, '404.html');
    res.statusCode = 404;
  }
  try {
    const body = await readFile(file);
    res.setHeader('content-type', types[extname(file)] ?? 'application/octet-stream');
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(port, () => console.log(`static export on http://localhost:${port}${base}/`));
