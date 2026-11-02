export interface ConnectionProfile {
  id: string;
  name: string;
  baseUrl: string;
  auth: 'basic' | 'anonymous';
  username: string;
  password: string;
  timeoutMs: number;
}

export interface DavEntry {
  path: string; // Encoded, absolute URL pathname. Never a display name.
  name: string;
  directory: boolean;
  size?: number;
  modified?: string;
  contentType?: string;
  etag?: string;
}

export interface RequestLog {
  id: string;
  time: string;
  operation: string;
  method: string;
  url: string;
  status?: number;
  durationMs: number;
  level: 'info' | 'error' | 'warning';
  message: string;
  headers: Record<string, string>;
  detail?: string;
}

export interface TransferTask {
  id: string;
  name: string;
  direction: 'upload' | 'download';
  state: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  loaded: number;
  total?: number;
  message?: string;
}

export interface Progress {
  loaded: number;
  total?: number;
}
export type LogWriter = (log: RequestLog) => void;
