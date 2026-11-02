import { describe, expect, it } from 'vitest';
import { childPath, displayPath, normalizeBase, scopedUrl } from './paths';

describe('WebDAV path boundaries', () => {
  it('encodes filenames per segment without treating #, ?, % or Unicode as URL syntax', () => {
    const path = childPath('/dav/', '中文 #100%?.txt');
    expect(path).toBe('/dav/%E4%B8%AD%E6%96%87%20%23100%25%3F.txt');
    expect(displayPath(path)).toBe('/dav/中文 #100%?.txt');
    expect(scopedUrl('https://example.com/dav/', path).pathname).toBe(path);
    expect(childPath('/dav/', ' padded name.txt ')).toBe('/dav/%20padded%20name.txt%20');
  });
  it('normalizes root trailing slashes and preserves already encoded base paths', () => {
    expect(normalizeBase('https://example.com/dav')).toBe('https://example.com/dav/');
    expect(normalizeBase('https://example.com/%E4%B8%AD/')).toBe('https://example.com/%E4%B8%AD/');
    expect(scopedUrl('https://example.com/%E4%B8%AD/', '/中/file.txt').pathname).toBe(
      '/%E4%B8%AD/file.txt',
    );
  });
  it.each([
    '/other/file',
    '/dav2/file',
    '//evil.example/dav/file',
    '/dav/../secret',
    '/dav/%2e%2e/secret',
    '/dav/a%2fb',
    '/dav/a%5cb',
    '/dav/%00',
  ])('rejects escaped or foreign paths: %s', (path) => {
    expect(() => scopedUrl('https://example.com/dav/', path)).toThrow();
  });
  it.each(['.', '..', 'a/b', 'a\\b', '', 'a\u0000'])('rejects invalid new names: %s', (name) =>
    expect(() => childPath('/dav/', name)).toThrow(),
  );
  it.each([
    'ftp://example.com/dav',
    'https://user:password@example.com/dav',
    'https://example.com/dav?token=a',
    'https://example.com/dav#part',
  ])('rejects non-WebDAV or credential-bearing base URLs: %s', (url) =>
    expect(() => normalizeBase(url)).toThrow(),
  );
});
