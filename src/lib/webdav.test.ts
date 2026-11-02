import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createFixture } from '../../scripts/webdav-fixture.mjs';
import { BrowserFile } from '../test-setup';
import { DavClient, assertMultiStatus, parseListing } from './webdav';
import { childPath } from './paths';
import type { ConnectionProfile, RequestLog } from '../types';

const xml = (body: string) => `<D:multistatus xmlns:D="DAV:">${body}</D:multistatus>`;
const item = (href: string, prop = '<D:resourcetype/>', status = '200 OK') =>
  `<D:response><D:href>${href}</D:href><D:propstat><D:prop>${prop}</D:prop><D:status>HTTP/1.1 ${status}</D:status></D:propstat></D:response>`;

describe('WebDAV XML', () => {
  it('understands namespace prefixes, skips self, and rejects foreign/outside/deep hrefs', () => {
    const body = xml(
      item('/dav/', '<D:resourcetype><D:collection/></D:resourcetype>') +
        item(
          '/dav/%E4%B8%AD%20%23.txt',
          '<D:resourcetype/><D:getcontentlength>0</D:getcontentlength>',
        ) +
        item('https://evil.example/dav/leak.txt') +
        item('/other/file') +
        item('/dav/deep/nested.txt') +
        item('/dav/folder/', '<D:resourcetype><D:collection/></D:resourcetype>'),
    );
    const entries = parseListing(body, 'https://example.com/dav/', '/dav/');
    expect(entries).toHaveLength(2);
    expect(entries[0].name).toBe('中 #.txt');
    expect(entries[0].size).toBe(0);
    expect(entries[1].directory).toBe(true);
  });
  it('retains successful properties while ignoring missing optional properties', () => {
    const body = xml(
      item('/dav/a.txt', '<D:resourcetype/><D:getcontentlength>12</D:getcontentlength>').replace(
        '</D:response>',
        '<D:propstat><D:prop><D:getetag/></D:prop><D:status>HTTP/1.1 404 Not Found</D:status></D:propstat></D:response>',
      ),
    );
    expect(parseListing(body, 'https://example.com/dav/', '/dav/')[0].size).toBe(12);
  });
  it('reports a failed root response, all-failed properties, malformed XML and a non-folder root', () => {
    expect(() =>
      parseListing(
        xml(
          '<D:response><D:href>/dav/</D:href><D:status>HTTP/1.1 403 Forbidden</D:status></D:response>',
        ),
        'https://example.com/dav/',
        '/dav/',
      ),
    ).toThrow('權限不足');
    expect(() =>
      parseListing(xml(item('/dav/', '', '403 Forbidden')), 'https://example.com/dav/', '/dav/'),
    ).toThrow('屬性');
    expect(() => parseListing('<html>login</html>', 'https://example.com/dav/', '/dav/')).toThrow(
      'XML',
    );
    expect(() => parseListing(xml(item('/dav/')), 'https://example.com/dav/', '/dav/')).toThrow(
      '是檔案',
    );
  });
  it('does not treat HTTP 207 as unconditional mutation success', () => {
    expect(() =>
      assertMultiStatus(
        xml(
          '<D:response><D:href>/dav/a.txt</D:href><D:status>HTTP/1.1 403 Forbidden</D:status></D:response>',
        ),
      ),
    ).toThrow('部分操作失敗');
    expect(() =>
      assertMultiStatus(
        xml(
          '<D:response><D:href>/dav/a.txt</D:href><D:status>HTTP/1.1 204 No Content</D:status></D:response>',
        ),
      ),
    ).not.toThrow();
  });
});

describe('real HTTP WebDAV fixture', () => {
  let fixture: Awaited<ReturnType<typeof createFixture>>;
  let profile: ConnectionProfile;
  let client: DavClient;
  const logs: RequestLog[] = [];
  beforeAll(async () => {
    fixture = await createFixture({ port: 0, origins: [location.origin] });
    profile = {
      id: 'test',
      name: 'fixture',
      baseUrl: fixture.url,
      auth: 'basic',
      username: fixture.username,
      password: fixture.password,
      timeoutMs: 5000,
    };
    client = new DavClient(profile, (log) => logs.push(log));
  });
  afterAll(async () => {
    client?.abortAll();
    await fixture?.close();
  });

  it('lists, uploads, downloads identical bytes, renames, copies, moves and deletes', async () => {
    expect((await client.list()).some((entry) => entry.name === '開始使用.md')).toBe(true);
    await client.options();
    const folder = childPath(client.root, 'roundtrip', true);
    await client.mkdir(folder);
    const source = childPath(client.root, '中文 #100%?.bin');
    const payload = new Uint8Array([0, 1, 13, 10, 128, 254, 255]);
    const progress = vi.fn();
    await client.upload(
      source,
      new BrowserFile([payload], '中文 #100%?.bin'),
      false,
      new AbortController().signal,
      progress,
    );
    expect(progress).toHaveBeenCalled();
    const entry = (await client.list()).find((entry) => entry.path === source)!;
    expect(entry).toBeDefined();
    const downloaded = await client.download(entry);
    expect(
      createHash('sha256')
        .update(new Uint8Array(await downloaded!.arrayBuffer()))
        .digest('hex'),
    ).toBe(createHash('sha256').update(payload).digest('hex'));
    const renamed = childPath(client.root, 'renamed.bin');
    await client.move(source, renamed);
    const copied = childPath(folder, 'copy.bin');
    await client.copy(renamed, copied);
    const moved = childPath(folder, 'moved.bin');
    await client.move(renamed, moved);
    expect((await client.list(folder)).map((entry) => entry.name).sort()).toEqual([
      'copy.bin',
      'moved.bin',
    ]);
    await expect(client.copy(copied, moved)).rejects.toMatchObject({ status: 412 });
    await expect(client.move(folder, childPath(folder, 'nested', true))).rejects.toThrow(
      '來源資料夾內',
    );
    await client.delete(folder);
    expect((await client.list()).some((entry) => entry.path === folder)).toBe(false);
    expect(JSON.stringify(logs)).not.toContain(fixture.password);
    expect(logs.some((log) => log.method === 'PUT' && log.status === 201)).toBe(true);
  });
  it('prevents silent overwrite on PUT', async () => {
    const target = childPath(client.root, 'no-overwrite.txt');
    await client.upload(
      target,
      new BrowserFile(['first'], 'no-overwrite.txt'),
      false,
      new AbortController().signal,
      () => {},
    );
    await expect(
      client.upload(
        target,
        new BrowserFile(['second'], 'no-overwrite.txt'),
        false,
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toMatchObject({ status: 412 });
    expect(
      await (await client.download(
        (await client.list()).find((entry) => entry.path === target)!,
      ))!.text(),
    ).toBe('first');
    await client.upload(
      target,
      new BrowserFile(['confirmed'], 'no-overwrite.txt'),
      true,
      new AbortController().signal,
      () => {},
    );
    expect(
      await (await client.download(
        (await client.list()).find((entry) => entry.path === target)!,
      ))!.text(),
    ).toBe('confirmed');
    await client.delete(target);
  });
  it.each([401, 403, 404, 409, 412, 423, 507])(
    'reports HTTP %s with a recorded status',
    async (status) => {
      await expect(client.list(`/dav/__status__/${status}/`)).rejects.toMatchObject({ status });
      expect(logs.at(-1)?.status).toBe(status);
      expect(logs.at(-1)?.level).toBe('error');
    },
  );
  it('reports bad credentials and partial mutation failure', async () => {
    const bad = new DavClient({ ...profile, password: 'wrong' }, (log) => logs.push(log));
    await expect(bad.list()).rejects.toMatchObject({ status: 401 });
    await expect(client.delete('/dav/__partial__/')).rejects.toThrow('部分操作失敗');
  });
  it('aborts all in-flight requests when changing host and distinguishes timeout', async () => {
    const pending = client.list('/dav/__slow__/');
    client.abortAll();
    await expect(pending).rejects.toThrow('已取消');
    expect(logs.at(-1)?.level).toBe('warning');
    const short = new DavClient({ ...profile, timeoutMs: 10 }, (log) => logs.push(log));
    await expect(short.list('/dav/__slow__/')).rejects.toThrow('逾時');
    expect(logs.at(-1)?.level).toBe('error');
  });
  it('enforces a bounded download without allocating a large Blob', async () => {
    const entry = (await client.list()).find((entry) => entry.name === '開始使用.md')!;
    await expect(client.download(entry, undefined, undefined, undefined, 2)).rejects.toThrow(
      '容量上限',
    );
  });
  it('streams to the destination and commits only after all bytes arrive', async () => {
    const entry = (await client.list()).find((entry) => entry.name === '開始使用.md')!;
    const chunks: Uint8Array[] = [];
    const sink = {
      write: vi.fn(async (value: Uint8Array) => {
        chunks.push(new Uint8Array(value));
      }),
      close: vi.fn(async () => {}),
      abort: vi.fn(async () => {}),
    };
    await expect(client.download(entry, undefined, undefined, sink, 2)).resolves.toBeUndefined();
    expect(sink.close).toHaveBeenCalledOnce();
    expect(sink.abort).not.toHaveBeenCalled();
    expect(Buffer.concat(chunks).toString()).toContain('WebDAV Studio 測試主機');
    const failed = {
      write: vi.fn(async () => {
        throw new Error('disk full');
      }),
      close: vi.fn(async () => {}),
      abort: vi.fn(async () => {}),
    };
    await expect(client.download(entry, undefined, undefined, failed)).rejects.toThrow('磁碟空間');
    expect(failed.abort).toHaveBeenCalledOnce();
    expect(failed.close).not.toHaveBeenCalled();
  });
  it('labels unreadable browser responses without asserting a CORS cause', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(client.list()).rejects.toThrow('可能是網路、CORS');
    expect(logs.at(-1)?.status).toBeUndefined();
  });
  it('enforces the memory limit even without Content-Length', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(20));
      },
      cancel,
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(body));
    await expect(
      client.download(
        { path: '/dav/chunked.bin', name: 'chunked.bin', directory: false },
        undefined,
        undefined,
        undefined,
        10,
      ),
    ).rejects.toThrow('記憶體容量上限');
    expect(cancel).toHaveBeenCalledOnce();
  });
});
