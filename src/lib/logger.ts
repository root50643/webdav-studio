import type { ConnectionProfile, RequestLog } from '../types';

export function basicToken(profile: Pick<ConnectionProfile, 'username' | 'password'>): string {
  return btoa(
    Array.from(new TextEncoder().encode(`${profile.username}:${profile.password}`), (b) =>
      String.fromCharCode(b),
    ).join(''),
  );
}

export function redact(text: string, secrets: string[] = []): string {
  let result = text
    .replace(/\b(Basic|Bearer)\s+[^\s<"']+/gi, '$1 [REDACTED]')
    .replace(
      /((?:password|passwd|token|secret|authorization|cookie)\s*[=:]\s*)[^\s&<"']+/gi,
      '$1[REDACTED]',
    )
    .replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/gi, '$1[REDACTED]@');
  const variants = secrets
    .filter(Boolean)
    .flatMap((secret) => [
      secret,
      encodeURIComponent(secret),
      encodeURIComponent(secret).replace(/%[0-9A-F]{2}/g, (value) => value.toLowerCase()),
      JSON.stringify(secret).slice(1, -1),
      secret.replace(
        /[&<>"']/g,
        (value) =>
          ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[value]!,
      ),
    ])
    .sort((a, b) => b.length - a.length);
  for (const secret of variants) result = result.split(secret).join('[REDACTED]');
  return result;
}

export function safeUrl(raw: string, secrets: string[] = []): string {
  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    url.hash = '';
    url.search = '';
    return redact(url.href, secrets);
  } catch {
    return '[無效網址]';
  }
}

const allowedHeaders = new Set([
  'content-type',
  'content-length',
  'dav',
  'allow',
  'etag',
  'last-modified',
  'retry-after',
  'x-request-id',
]);

export function safeHeaders(headers: Headers, secrets: string[] = []): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (allowedHeaders.has(key.toLowerCase())) result[key] = redact(value, secrets).slice(0, 512);
  });
  return result;
}

export function appendLog(logs: RequestLog[], log: RequestLog): RequestLog[] {
  return [...logs.slice(-499), log];
}

export function exportLogs(logs: RequestLog[]): string {
  return JSON.stringify(logs, null, 2);
}
