import { describe, expect, it } from 'vitest';
import { previewKind } from './files';
import type { DavEntry } from '../types';

const entry = (name: string, contentType?: string): DavEntry => ({
  path: `/dav/${name}`,
  name,
  contentType,
  directory: false,
});
describe('preview policy', () => {
  it('does not embed active content, even with a misleading extension or MIME type', () => {
    for (const value of [
      entry('index.html', 'text/plain'),
      entry('image.SVG', 'image/png'),
      entry('notes.txt', 'text/html'),
      entry('photo.png', 'image/svg+xml'),
      entry('page.xhtml'),
      entry('data.xml'),
    ])
      expect(previewKind(value)).toBeUndefined();
    expect(previewKind(entry('photo.png', 'image/png'))).toBe('image');
    expect(previewKind(entry('notes.md', 'text/markdown'))).toBe('text');
    expect(previewKind(entry('document.pdf', 'application/pdf'))).toBeUndefined();
  });
});
