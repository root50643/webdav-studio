export function normalizeBase(input: string): string {
  const url = new URL(input.trim());
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('請使用 HTTPS 或 HTTP 網址。');
  if (url.username || url.password) throw new Error('請將帳號密碼填入專用欄位，不要放在網址中。');
  if (url.search || url.hash) throw new Error('WebDAV 根目錄網址不能包含查詢參數或片段。');
  // URL normalizes dot segments; reject encoded path separators, which servers may reinterpret.
  validatePath(url.pathname);
  url.pathname = url.pathname.replace(/\/*$/, '/');
  return url.href;
}

export function validatePath(path: string): void {
  if (!path.startsWith('/') || /[\\\u0000-\u001f\u007f]/.test(path))
    throw new Error('無效的檔案路徑。');
  for (const part of path.split('/')) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(part);
    } catch {
      throw new Error('檔案路徑編碼不正確。');
    }
    if (decoded === '.' || decoded === '..' || /[/\\\u0000-\u001f\u007f]/.test(decoded)) {
      throw new Error('檔案路徑包含不允許的片段。');
    }
  }
}

export function scopedUrl(base: string, path: string): URL {
  validatePath(path);
  const root = new URL(base);
  const url = new URL(path, root);
  const canonical = (value: string) => value.split('/').map(decodeURIComponent).join('/');
  const rootPath = canonical(root.pathname).replace(/\/*$/, '/');
  const candidate = canonical(url.pathname);
  if (
    url.origin !== root.origin ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    !(candidate === rootPath.slice(0, -1) || candidate.startsWith(rootPath))
  ) {
    throw new Error('這個路徑不在此連線的根目錄內。');
  }
  return url;
}

export function childPath(parent: string, name: string, directory = false): string {
  const clean = name;
  if (!clean.trim() || clean === '.' || clean === '..' || /[/\\\u0000-\u001f\u007f]/.test(clean)) {
    throw new Error('名稱不可空白，或包含斜線、反斜線與控制字元。');
  }
  return `${parent.replace(/\/*$/, '/')}${encodeURIComponent(clean)}${directory ? '/' : ''}`;
}

export function displayPath(path: string): string {
  return path
    .split('/')
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    })
    .join('/');
}

export function formatBytes(size?: number): string {
  if (size === undefined || !Number.isFinite(size)) return '—';
  if (size === 0) return '0 B';
  const unit = Math.min(Math.floor(Math.log(Math.max(size, 1)) / Math.log(1024)), 4);
  return `${(size / 1024 ** unit).toLocaleString('zh-TW', { maximumFractionDigits: unit ? 1 : 0 })} ${['B', 'KB', 'MB', 'GB', 'TB'][unit]}`;
}

export function formatDate(value?: string): string {
  if (!value || !Number.isFinite(Date.parse(value))) return '—';
  return new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}
