/** Development-only, in-memory WebDAV server. Never bundled or deployed. */
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const ROOT = '/dav/';
const USER = 'demo';
const PASSWORD = 'studio-test';
const xmlEscape = (value) =>
  String(value).replace(
    /[<>&"']/g,
    (character) =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character],
  );
const encoded = (path) => path.split('/').map(encodeURIComponent).join('/');
const parent = (path) => path.replace(/\/$/, '').replace(/[^/]+$/, '');
const statusXml = (status) =>
  `<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/blocked.txt</d:href><d:status>HTTP/1.1 ${status} Forbidden</d:status></d:response></d:multistatus>`;

export async function createFixture({
  port = 1900,
  origins = [
    'http://127.0.0.1:5173',
    'http://localhost:5173',
    'http://127.0.0.1:4173',
    'http://localhost:4173',
  ],
} = {}) {
  const nodes = new Map();
  const add = (path, directory, body = '', type = 'text/plain; charset=utf-8') =>
    nodes.set(path, {
      directory,
      body: Buffer.isBuffer(body) ? body : Buffer.from(body),
      type,
      modified: new Date().toUTCString(),
    });
  add(ROOT, true);
  add('/dav/專案文件/', true);
  add('/dav/設計素材/', true);
  add('/dav/照片備份/', true);
  add(
    '/dav/開始使用.md',
    false,
    '# WebDAV Studio 測試主機\n\n這些資料只存在記憶體，重啟主機後會重設。\n\n可上傳、下載、重新命名、移動、複製及刪除。',
    'text/markdown; charset=utf-8',
  );
  add(
    '/dav/網站設定.json',
    false,
    JSON.stringify({ project: 'WebDAV Studio', language: '繁體中文', frontendOnly: true }, null, 2),
    'application/json',
  );
  add(
    '/dav/靈感筆記.txt',
    false,
    '把重要的靈感，放在自己的雲端。\n這是 WebDAV Studio 的測試檔案。',
  );
  add('/dav/專案文件/計畫.txt', false, '第一階段：建立自己的檔案工作空間。');
  add(
    '/dav/照片備份/測試圖片.png',
    false,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=',
      'base64',
    ),
    'image/png',
  );
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      let path;
      try {
        path = decodeURIComponent(url.pathname);
      } catch {
        response.writeHead(400).end();
        return;
      }
      const origin = request.headers.origin;
      if (!path.includes('__cors__') && origin && origins.includes(origin)) {
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Vary', 'Origin');
        response.setHeader(
          'Access-Control-Allow-Methods',
          'OPTIONS, PROPFIND, GET, HEAD, PUT, DELETE, MKCOL, COPY, MOVE',
        );
        response.setHeader(
          'Access-Control-Allow-Headers',
          'Authorization, Content-Type, Depth, Destination, Overwrite, If-None-Match, If-Match',
        );
        response.setHeader(
          'Access-Control-Expose-Headers',
          'DAV, Allow, ETag, Content-Length, Content-Type, Last-Modified',
        );
      }
      response.setHeader('Cache-Control', 'no-store');
      if (request.method === 'OPTIONS') {
        response.setHeader('DAV', '1, 2');
        response.setHeader('Allow', 'OPTIONS, PROPFIND, GET, HEAD, PUT, DELETE, MKCOL, COPY, MOVE');
        response.writeHead(204).end();
        return;
      }
      if (
        request.headers.authorization !==
        `Basic ${Buffer.from(`${USER}:${PASSWORD}`).toString('base64')}`
      ) {
        response.setHeader(
          'WWW-Authenticate',
          'Basic realm="WebDAV Studio fixture", charset="UTF-8"',
        );
        response.writeHead(401).end('Authentication required');
        return;
      }
      if (!path.startsWith(ROOT)) {
        response.writeHead(403).end();
        return;
      }
      if (path.includes('__slow__')) await new Promise((resolve) => setTimeout(resolve, 500));
      const forcedStatus = /__status__\/(\d{3})/.exec(path)?.[1];
      if (forcedStatus) {
        response
          .writeHead(Number(forcedStatus), { 'Content-Type': 'text/plain' })
          .end('Fixture error response');
        return;
      }
      if (path.includes('__partial__')) {
        response.writeHead(207, { 'Content-Type': 'application/xml' }).end(statusXml(403));
        return;
      }
      if (nodes.has(`${path}/`)) path += '/';
      const node = nodes.get(path);
      const reply = (status, body = '') => response.writeHead(status).end(body);
      const isFolder = (target) => nodes.get(target)?.directory;
      if (request.method === 'PROPFIND') {
        request.resume();
        if (!node) {
          reply(404);
          return;
        }
        const paths = [
          path,
          ...(node.directory && request.headers.depth !== '0'
            ? [...nodes.keys()].filter((key) => key !== path && parent(key) === path)
            : []),
        ];
        const xml = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${paths
          .map((key) => {
            const item = nodes.get(key);
            return `<d:response><d:href>${xmlEscape(encoded(key))}</d:href><d:propstat><d:prop><d:resourcetype>${item.directory ? '<d:collection/>' : ''}</d:resourcetype><d:getcontentlength>${item.body.length}</d:getcontentlength><d:getcontenttype>${xmlEscape(item.type)}</d:getcontenttype><d:getlastmodified>${item.modified}</d:getlastmodified><d:getetag>&quot;fixture-${item.body.length}&quot;</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
          })
          .join('')}</d:multistatus>`;
        response.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' }).end(xml);
        return;
      }
      if (request.method === 'GET' || request.method === 'HEAD') {
        if (!node) {
          reply(404);
          return;
        }
        if (node.directory) {
          reply(405);
          return;
        }
        response
          .writeHead(200, {
            'Content-Type': node.type,
            'Content-Length': node.body.length,
            ETag: `"fixture-${node.body.length}"`,
          })
          .end(request.method === 'HEAD' ? undefined : node.body);
        return;
      }
      if (request.method === 'MKCOL') {
        if (node) {
          reply(405);
          return;
        }
        const directory = path.replace(/\/*$/, '/');
        if (!isFolder(parent(directory))) {
          reply(409);
          return;
        }
        add(directory, true);
        reply(201);
        return;
      }
      if (request.method === 'PUT') {
        if (!isFolder(parent(path))) {
          request.resume();
          reply(409);
          return;
        }
        if (node?.directory || (node && request.headers['if-none-match'] === '*')) {
          request.resume();
          reply(412);
          return;
        }
        const chunks = [];
        let bytes = 0;
        for await (const chunk of request) {
          bytes += chunk.length;
          if (bytes > 32 * 1024 * 1024) {
            reply(413);
            return;
          }
          chunks.push(chunk);
        }
        add(
          path,
          false,
          Buffer.concat(chunks),
          request.headers['content-type'] || 'application/octet-stream',
        );
        reply(node ? 204 : 201);
        return;
      }
      if (request.method === 'DELETE') {
        if (!node) {
          reply(404);
          return;
        }
        if (path === ROOT) {
          reply(403);
          return;
        }
        for (const key of [...nodes.keys()])
          if (key === path || (node.directory && key.startsWith(path))) nodes.delete(key);
        reply(204);
        return;
      }
      if (request.method === 'MOVE' || request.method === 'COPY') {
        if (!node) {
          reply(404);
          return;
        }
        if (!request.headers.destination) {
          reply(400);
          return;
        }
        const target = new URL(request.headers.destination);
        let destination = decodeURIComponent(target.pathname);
        if (target.origin !== url.origin || !destination.startsWith(ROOT)) {
          reply(403);
          return;
        }
        if (node.directory) destination = destination.replace(/\/*$/, '/');
        if (destination === path || (node.directory && destination.startsWith(path))) {
          reply(409);
          return;
        }
        if (!isFolder(parent(destination))) {
          reply(409);
          return;
        }
        if (nodes.has(destination) && request.headers.overwrite === 'F') {
          reply(412);
          return;
        }
        const selected = [...nodes.entries()].filter(
          ([key]) => key === path || (node.directory && key.startsWith(path)),
        );
        for (const [key, item] of selected)
          nodes.set(destination + key.slice(path.length), {
            ...item,
            body: Buffer.from(item.body),
          });
        if (request.method === 'MOVE') for (const [key] of selected) nodes.delete(key);
        reply(201);
        return;
      }
      reply(405);
    } catch {
      if (!response.headersSent) response.writeHead(500);
      response.end('Fixture failure');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/dav/`,
    username: USER,
    password: PASSWORD,
    nodes,
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixture = await createFixture({ port: Number(process.env.FIXTURE_PORT || 1900) });
  console.log(
    `Development-only WebDAV fixture: ${fixture.url}\nUsername: ${fixture.username}\nPassword: ${fixture.password}\nIn-memory data; restarts reset all changes. Bound to 127.0.0.1 only.`,
  );
  const stop = async () => {
    await fixture.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
