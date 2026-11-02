import { describe, expect, it } from 'vitest';
import { appendLog, basicToken, exportLogs, redact, safeHeaders, safeUrl } from './logger';
import type { RequestLog } from '../types';

describe('debug log privacy', () => {
  it('never retains authentication, query values, cookies or known secrets', () => {
    const password = 'private-pass';
    const token = basicToken({ username: '測試', password });
    expect(
      redact(`Authorization: Basic ${token} ${password} ${encodeURIComponent(password)}`, [
        password,
        token,
      ]),
    ).not.toContain(password);
    expect(
      safeUrl('https://user:private-pass@example.com/dav/file?secret=private-pass#token', [
        password,
      ]),
    ).toBe('https://example.com/dav/file');
    const headers = safeHeaders(
      new Headers({
        Authorization: `Basic ${token}`,
        'Set-Cookie': 'session=private-pass',
        'X-Internal-Secret': password,
        ETag: password,
        DAV: '1,2',
      }),
      [password, token],
    );
    expect(headers).toEqual({ dav: '1,2', etag: '[REDACTED]' });
    expect(JSON.stringify(headers)).not.toContain(password);
  });
  it('keeps at most 500 sanitized records for the same export path', () => {
    let logs: RequestLog[] = [];
    for (let i = 0; i < 600; i++)
      logs = appendLog(logs, {
        id: String(i),
        time: '',
        operation: 'list',
        method: 'PROPFIND',
        url: 'https://example.com/dav/',
        durationMs: 2,
        level: 'info',
        message: 'ok',
        headers: {},
      });
    expect(logs).toHaveLength(500);
    expect(logs[0].id).toBe('100');
    expect(JSON.parse(exportLogs(logs))).toEqual(logs);
  });
  it('redacts reflected passwords escaped in XML and JSON error bodies', () => {
    const secret = 'private&"<secret>';
    expect(redact('private&amp;&quot;&lt;secret&gt;', [secret])).toBe('[REDACTED]');
    expect(redact(JSON.stringify(secret).slice(1, -1), [secret])).toBe('[REDACTED]');
  });
});
