/** Strict static preview under a GitHub Pages-like project path; no SPA fallback. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';

const directory = fileURLToPath(new URL('../dist/', import.meta.url));
const prefix = '/pages-check/';
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (!url.pathname.startsWith(prefix)) {
      response.writeHead(404).end('Not found');
      return;
    }
    const path = decodeURIComponent(url.pathname.slice(prefix.length));
    const file = resolve(directory, path || 'index.html');
    const local = relative(directory, file);
    if (local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) {
      response.writeHead(403).end();
      return;
    }
    const bytes = await readFile(file);
    response
      .writeHead(200, {
        'Content-Type': types[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      })
      .end(bytes);
  } catch {
    response.writeHead(404).end('Not found');
  }
});
server.listen(4173, '127.0.0.1', () =>
  console.log('Strict project Pages preview: http://127.0.0.1:4173/pages-check/'),
);
