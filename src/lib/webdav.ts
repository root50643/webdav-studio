import type { ConnectionProfile, DavEntry, LogWriter, Progress } from '../types';
import { basicToken, redact, safeHeaders, safeUrl } from './logger';
import { normalizeBase, scopedUrl, displayPath } from './paths';

export const BLOB_LIMIT = 256 * 1024 * 1024;
const XML_LIMIT = 8 * 1024 * 1024;
const properties =
  '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:resourcetype/><d:getcontentlength/><d:getlastmodified/><d:getcontenttype/><d:getetag/></d:prop></d:propfind>';
export class DavError extends Error {
  constructor(
    message: string,
    public status?: number,
    public detail?: string,
  ) {
    super(message);
    this.name = 'DavError';
  }
}

export function statusMessage(status: number): string {
  const messages: Record<number, string> = {
    400: '請求格式不正確。',
    401: '驗證失敗，請確認帳號與密碼。',
    403: '權限不足，主機拒絕這項操作。',
    404: '找不到檔案或資料夾，請重新整理。',
    405: '主機不支援這個 WebDAV 操作，請檢查服務網址。',
    409: '目標資料夾不存在，或檔案路徑衝突。',
    412: '目標已存在或已被修改，尚未覆寫。',
    413: '檔案超過主機允許的大小。',
    423: '檔案已被鎖定，請稍後再試。',
    429: '請求過於頻繁，請稍後再試。',
    507: '主機儲存空間不足。',
  };
  return messages[status] ?? `主機回傳 HTTP ${status}，請查看除錯紀錄。`;
}

function parseXml(xml: string): XMLDocument {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (
    doc.getElementsByTagName('parsererror').length ||
    doc.documentElement.localName !== 'multistatus' ||
    doc.documentElement.namespaceURI !== 'DAV:'
  ) {
    throw new DavError('主機回傳的 WebDAV XML 無效，可能是登入頁或服務網址不正確。');
  }
  return doc;
}
function children(element: Element, name: string): Element[] {
  return Array.from(element.children).filter(
    (child) => child.localName === name && child.namespaceURI === 'DAV:',
  );
}
function text(element: Element, name: string): string {
  return children(element, name)[0]?.textContent?.trim() ?? '';
}
function code(status: string): number {
  return Number(/HTTP\/\S+\s+(\d{3})/.exec(status)?.[1] ?? 0);
}
const canonicalPath = (path: string) => displayPath(path).replace(/\/*$/, '/');

export function parseListing(xml: string, base: string, currentPath: string): DavEntry[] {
  const doc = parseXml(xml);
  const current = scopedUrl(base, currentPath);
  const prefix = canonicalPath(current.pathname);
  const entries = new Map<string, DavEntry>();
  for (const response of children(doc.documentElement, 'response')) {
    const href = text(response, 'href');
    if (!href) continue;
    let resource: URL;
    try {
      const resolved = new URL(href, current);
      if (
        resolved.origin !== current.origin ||
        resolved.search ||
        resolved.hash ||
        resolved.username ||
        resolved.password
      )
        continue;
      resource = scopedUrl(base, resolved.pathname);
    } catch {
      continue;
    }
    const normalized = canonicalPath(resource.pathname);
    if (!normalized.startsWith(prefix)) continue;
    const responseStatus = code(text(response, 'status'));
    if (responseStatus && (responseStatus < 200 || responseStatus >= 300))
      throw new DavError(`目錄有項目無法讀取：${statusMessage(responseStatus)}`, responseStatus);
    const props = children(response, 'propstat')
      .filter((stat) => {
        const status = code(text(stat, 'status'));
        return status >= 200 && status < 300;
      })
      .flatMap((stat) => children(stat, 'prop'));
    if (!props.length) {
      const failedStatus = code(text(children(response, 'propstat')[0] ?? response, 'status'));
      throw new DavError(
        `無法讀取目錄項目的屬性：${statusMessage(failedStatus || 500)}`,
        failedStatus || undefined,
      );
    }
    if (normalized === prefix) {
      const types = props.flatMap((prop) => children(prop, 'resourcetype'));
      if (types.length && !types.some((type) => children(type, 'collection').length > 0))
        throw new DavError('此路徑是檔案，請使用 WebDAV 資料夾網址。');
      continue;
    }
    const relative = normalized.slice(prefix.length).replace(/\/$/, '');
    if (!relative || relative.includes('/')) continue;
    const get = (name: string) => props.map((prop) => text(prop, name)).find(Boolean) ?? '';
    const directory = props.some((prop) =>
      children(prop, 'resourcetype').some((type) => children(type, 'collection').length > 0),
    );
    const sizeText = get('getcontentlength');
    const size =
      sizeText && Number.isFinite(Number(sizeText)) && Number(sizeText) >= 0
        ? Number(sizeText)
        : undefined;
    const path = directory ? resource.pathname.replace(/\/*$/, '/') : resource.pathname;
    // A server-provided displayname is not a path. Derive the actual name from href.
    const name = displayPath(resource.pathname.replace(/\/$/, '').split('/').pop() ?? '');
    entries.set(normalized, {
      path,
      name,
      directory,
      size: directory ? undefined : size,
      modified: get('getlastmodified') || undefined,
      contentType: get('getcontenttype') || undefined,
      etag: get('getetag') || undefined,
    });
  }
  return [...entries.values()];
}

export function assertMultiStatus(xml: string): void {
  const doc = parseXml(xml);
  const failures: string[] = [];
  for (const response of children(doc.documentElement, 'response')) {
    const statuses = [
      text(response, 'status'),
      ...children(response, 'propstat').map((stat) => text(stat, 'status')),
    ].filter(Boolean);
    for (const status of statuses) {
      const value = code(status);
      if (value < 200 || value >= 300) failures.push(`${text(response, 'href')}: ${value}`);
    }
  }
  if (failures.length)
    throw new DavError(
      `部分操作失敗（${failures.length} 項），請重新整理並查看紀錄。`,
      207,
      failures.join('\n').slice(0, 4096),
    );
}

async function readBounded(
  response: Response,
  limit: number,
  signal?: AbortSignal,
  progress?: (p: Progress) => void,
  sink?: DownloadSink,
): Promise<Blob | undefined> {
  const sizeHeader = response.headers.get('content-length');
  const parsed = sizeHeader === null ? NaN : Number(sizeHeader);
  const total = Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  if (!sink && total !== undefined && total > limit) {
    await response.body?.cancel();
    throw new DavError(
      `檔案超過此操作的容量上限（${Math.round(limit / 1024 / 1024)} MiB）。請使用 Chrome／Edge 的直接存檔功能下載大檔。`,
    );
  }
  const parts: ArrayBuffer[] = [];
  let loaded = 0;
  if (!response.body) {
    if (total === 0) return sink ? undefined : new Blob([]);
    throw new DavError('主機未提供可讀取的回應內容。');
  }
  const reader = response.body.getReader();
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      loaded += value.byteLength;
      if (!sink && loaded > limit)
        throw new DavError(
          `下載已停止：超過 ${Math.round(limit / 1024 / 1024)} MiB 的記憶體容量上限。`,
        );
      if (sink) {
        try {
          await sink.write(value);
        } catch {
          throw new DavError('無法寫入目的檔案，請檢查磁碟空間與檔案存取權限。');
        }
      } else parts.push(new Uint8Array(value).buffer);
      progress?.({ loaded, total });
    }
    signal?.throwIfAborted();
    progress?.({ loaded, total: total ?? loaded });
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  return sink
    ? undefined
    : new Blob(parts, { type: response.headers.get('content-type') ?? 'application/octet-stream' });
}

async function errorSnippet(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  let result = '';
  const decoder = new TextDecoder();
  try {
    while (result.length < 4096) {
      const part = await reader.read();
      if (part.done) break;
      result += decoder.decode(part.value.subarray(0, 4096), { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return result.slice(0, 4096);
}

export interface DownloadSink {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}
interface Options {
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  operation: string;
}

export class DavClient {
  readonly base: string;
  readonly root: string;
  private controllers = new Set<AbortController>();
  private secrets: string[];
  constructor(
    readonly profile: ConnectionProfile,
    private log: LogWriter,
  ) {
    this.base = normalizeBase(profile.baseUrl);
    this.root = new URL(this.base).pathname;
    this.secrets = profile.auth === 'basic' ? [profile.password, basicToken(profile)] : [];
  }

  abortAll(): void {
    this.controllers.forEach((controller) => controller.abort());
    this.controllers.clear();
  }
  private authorization(): Record<string, string> {
    return this.profile.auth === 'basic'
      ? { Authorization: `Basic ${basicToken(this.profile)}` }
      : {};
  }

  private context(signal?: AbortSignal) {
    const controller = new AbortController();
    this.controllers.add(controller);
    let timedOut = false;
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.profile.timeoutMs);
    return {
      signal: controller.signal,
      timedOut: () => timedOut,
      finish: () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        this.controllers.delete(controller);
      },
    };
  }

  private async request<T>(
    method: string,
    path: string,
    options: Options,
    consume: (response: Response, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const url = scopedUrl(this.base, path);
    if (location.protocol === 'https:' && url.protocol === 'http:')
      throw new DavError('此頁面使用 HTTPS，無法直接連線 HTTP WebDAV。請替主機啟用有效的 HTTPS。');
    const context = this.context(options.signal);
    const start = performance.now();
    let response: Response | undefined;
    let failure: DavError | undefined;
    try {
      response = await fetch(url, {
        method,
        headers: { ...this.authorization(), ...options.headers },
        body: options.body,
        signal: context.signal,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
      if (!response.ok)
        throw new DavError(
          statusMessage(response.status),
          response.status,
          redact(await errorSnippet(response), this.secrets),
        );
      return await consume(response, context.signal);
    } catch (error) {
      if (context.timedOut())
        failure = new DavError('請求逾時。請確認主機狀態，或增加此連線的逾時秒數。');
      else if (context.signal.aborted) failure = new DavError('操作已取消。');
      else if (error instanceof DavError)
        failure = new DavError(
          redact(error.message, this.secrets),
          error.status,
          error.detail ? redact(error.detail, this.secrets) : undefined,
        );
      else
        failure = new DavError(
          '瀏覽器無法讀取主機回應。可能是網路、CORS、憑證或重新導向問題；請查看 Console／Network。',
        );
      throw failure;
    } finally {
      context.finish();
      this.log({
        id: crypto.randomUUID(),
        time: new Date().toISOString(),
        operation: options.operation,
        method,
        url: safeUrl(url.href, this.secrets),
        status: response?.status,
        durationMs: Math.round(performance.now() - start),
        level: failure
          ? context.signal.aborted && !context.timedOut()
            ? 'warning'
            : 'error'
          : 'info',
        message: failure?.message ?? '請求完成',
        headers: response ? safeHeaders(response.headers, this.secrets) : {},
        detail: failure?.detail,
      });
    }
  }

  async list(path = this.root, signal?: AbortSignal): Promise<DavEntry[]> {
    return this.request(
      'PROPFIND',
      path,
      {
        operation: '讀取資料夾',
        body: properties,
        headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
        signal,
      },
      async (response, innerSignal) => {
        const body = await readBounded(response, XML_LIMIT, innerSignal);
        return parseListing(await body!.text(), this.base, path);
      },
    );
  }

  async options(signal?: AbortSignal): Promise<void> {
    await this.request(
      'OPTIONS',
      this.root,
      { operation: '檢查主機能力', signal },
      async (response) => {
        await response.body?.cancel();
      },
    );
  }

  private async mutate(
    method: string,
    path: string,
    headers: Record<string, string> = {},
    signal?: AbortSignal,
  ): Promise<void> {
    const names: Record<string, string> = {
      MKCOL: '新增資料夾',
      DELETE: '刪除',
      MOVE: '移動／重新命名',
      COPY: '複製',
    };
    await this.request(
      method,
      path,
      { operation: names[method] ?? method, headers, signal },
      async (response, innerSignal) => {
        if (response.status === 207) {
          const body = await readBounded(response, XML_LIMIT, innerSignal);
          assertMultiStatus(await body!.text());
        } else await response.body?.cancel();
      },
    );
  }
  mkdir(path: string, signal?: AbortSignal): Promise<void> {
    return this.mutate('MKCOL', path, {}, signal);
  }
  delete(path: string, signal?: AbortSignal): Promise<void> {
    return this.mutate('DELETE', path, {}, signal);
  }
  move(source: string, destination: string, signal?: AbortSignal): Promise<void> {
    return this.relocate('MOVE', source, destination, signal);
  }
  copy(source: string, destination: string, signal?: AbortSignal): Promise<void> {
    return this.relocate('COPY', source, destination, signal);
  }
  private relocate(
    method: string,
    source: string,
    destination: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const target = scopedUrl(this.base, destination);
    const from = scopedUrl(this.base, source);
    if (
      canonicalPath(target.pathname) === canonicalPath(from.pathname) ||
      canonicalPath(target.pathname).startsWith(canonicalPath(from.pathname))
    ) {
      return Promise.reject(new DavError('目標不可與來源相同，或位於來源資料夾內。'));
    }
    return this.mutate(
      method,
      source,
      {
        Destination: target.href,
        Overwrite: 'F',
        ...(method === 'COPY' ? { Depth: 'infinity' } : {}),
      },
      signal,
    );
  }

  async download(
    entry: DavEntry,
    signal?: AbortSignal,
    progress?: (p: Progress) => void,
    sink?: DownloadSink,
    limit = BLOB_LIMIT,
  ): Promise<Blob | undefined> {
    try {
      const result = await this.request(
        'GET',
        entry.path,
        { operation: '下載檔案', signal },
        (response, innerSignal) => readBounded(response, limit, innerSignal, progress, sink),
      );
      signal?.throwIfAborted();
      await sink?.close();
      return result;
    } catch (error) {
      await sink?.abort(error).catch(() => {});
      throw error;
    }
  }

  async upload(
    path: string,
    file: File,
    overwrite: boolean,
    signal: AbortSignal,
    progress: (p: Progress) => void,
  ): Promise<void> {
    const url = scopedUrl(this.base, path);
    if (location.protocol === 'https:' && url.protocol === 'http:')
      throw new DavError('HTTPS 頁面無法直接上傳到 HTTP 主機。');
    const context = this.context(signal);
    const start = performance.now();
    let status: number | undefined;
    let headers = new Headers();
    let failure: DavError | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const abort = () => xhr.abort();
        context.signal.addEventListener('abort', abort, { once: true });
        const clean = () => context.signal.removeEventListener('abort', abort);
        xhr.upload.onprogress = (event) =>
          progress({
            loaded: event.loaded,
            total: event.lengthComputable ? event.total : file.size,
          });
        xhr.onload = () => {
          clean();
          status = xhr.status;
          for (const line of xhr
            .getAllResponseHeaders()
            .trim()
            .split(/[\r\n]+/)) {
            const colon = line.indexOf(':');
            if (colon > 0)
              headers.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
          }
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              if (xhr.status === 207) assertMultiStatus(xhr.responseText);
              resolve();
            } catch (error) {
              reject(error);
            }
          } else
            reject(
              new DavError(
                statusMessage(xhr.status),
                xhr.status,
                redact(xhr.responseText.slice(0, 4096), this.secrets),
              ),
            );
        };
        xhr.onerror = () => {
          clean();
          reject(
            new DavError(
              '瀏覽器無法讀取主機回應。可能是網路、CORS 或憑證問題；請查看 Console／Network。',
            ),
          );
        };
        xhr.onabort = () => {
          clean();
          reject(
            new DavError(context.timedOut() ? '上傳逾時，請增加連線的逾時秒數。' : '操作已取消。'),
          );
        };
        xhr.open('PUT', url.href);
        for (const [key, value] of Object.entries(this.authorization()))
          xhr.setRequestHeader(key, value);
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        if (!overwrite) xhr.setRequestHeader('If-None-Match', '*');
        if (context.signal.aborted) {
          clean();
          reject(new DavError('操作已取消。'));
          return;
        }
        xhr.send(file);
      });
      progress({ loaded: file.size, total: file.size });
    } catch (error) {
      failure =
        error instanceof DavError
          ? new DavError(
              redact(error.message, this.secrets),
              error.status,
              error.detail ? redact(error.detail, this.secrets) : undefined,
            )
          : new DavError('上傳失敗，請查看除錯紀錄。');
      throw failure;
    } finally {
      context.finish();
      this.log({
        id: crypto.randomUUID(),
        time: new Date().toISOString(),
        operation: '上傳檔案',
        method: 'PUT',
        url: safeUrl(url.href, this.secrets),
        status,
        durationMs: Math.round(performance.now() - start),
        level: failure
          ? context.signal.aborted && !context.timedOut()
            ? 'warning'
            : 'error'
          : 'info',
        message: failure?.message ?? '上傳完成',
        headers: safeHeaders(headers, this.secrets),
        detail: failure?.detail,
      });
    }
  }
}
