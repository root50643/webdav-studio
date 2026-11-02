import type { DavEntry } from '../types';

export function previewKind(entry: DavEntry): 'image' | 'text' | undefined {
  if (entry.directory) return undefined;
  const extension = entry.name.split('.').pop()?.toLowerCase() ?? '';
  const mime = entry.contentType?.split(';')[0].trim().toLowerCase();
  if (
    ['html', 'htm', 'svg', 'svgz', 'xhtml', 'xml'].includes(extension) ||
    ['text/html', 'image/svg+xml', 'application/xhtml+xml'].includes(mime ?? '')
  )
    return undefined;
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp', 'ico'].includes(extension))
    return 'image';
  if (
    [
      'txt',
      'md',
      'json',
      'csv',
      'tsv',
      'log',
      'yaml',
      'yml',
      'toml',
      'ini',
      'css',
      'js',
      'ts',
      'jsx',
      'tsx',
      'py',
      'sh',
      'sql',
      'env',
      'gitignore',
    ].includes(extension)
  )
    return 'text';
  return undefined;
}

export function entryType(entry: DavEntry): string {
  if (entry.directory) return '資料夾';
  const extension = entry.name.split('.').pop()?.toLowerCase();
  const names: Record<string, string> = {
    pdf: 'PDF 文件',
    docx: 'Word 文件',
    xlsx: 'Excel 試算表',
    pptx: '簡報',
    zip: 'ZIP 壓縮檔',
    md: 'Markdown',
    txt: '文字文件',
    json: 'JSON',
    mp4: '影片',
    mp3: '音訊',
  };
  if (previewKind(entry) === 'image') return '圖片';
  return names[extension ?? ''] ?? (extension ? `${extension.toUpperCase()} 檔案` : '檔案');
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export interface SaveHandle {
  createWritable(): Promise<{
    write(data: Uint8Array): Promise<void>;
    close(): Promise<void>;
    abort(reason?: unknown): Promise<void>;
  }>;
}
export function filePicker():
  ((options: { suggestedName: string }) => Promise<SaveHandle>) | undefined {
  return (
    window as Window & {
      showSaveFilePicker?: (options: { suggestedName: string }) => Promise<SaveHandle>;
    }
  ).showSaveFilePicker?.bind(window);
}
