import { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Download,
  FileTerminal,
  LoaderCircle,
  RotateCcw,
  Search,
  Terminal,
  Trash2,
  X,
  CircleAlert,
} from 'lucide-react';
import type { RequestLog, TransferTask } from '../types';
import { exportLogs } from '../lib/logger';
import { formatBytes } from '../lib/paths';
import { saveBlob } from '../lib/files';

export function ActivityPanels({
  logs,
  tasks,
  open,
  onToggle,
  onClearLogs,
  onCancel,
  onRetry,
  onClearTasks,
  notify,
}: {
  logs: RequestLog[];
  tasks: TransferTask[];
  open: 'logs' | 'transfers' | null;
  onToggle: (tab: 'logs' | 'transfers') => void;
  onClearLogs: () => void;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onClearTasks: () => void;
  notify: (message: string) => void;
}) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string>();
  const errors = logs.filter((log) => log.level === 'error').length;
  const running = tasks.filter(
    (task) => task.state === 'running' || task.state === 'queued',
  ).length;
  const filtered = logs
    .filter(
      (log) =>
        (filter === 'all' || log.level === filter) &&
        `${log.operation} ${log.method} ${log.url} ${log.status ?? ''} ${log.message}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .toReversed();
  async function copy() {
    try {
      await navigator.clipboard.writeText(exportLogs(logs));
      notify('已複製遮蔽敏感資訊的紀錄');
    } catch {
      notify('無法存取剪貼簿，請改用匯出紀錄');
    }
  }
  return (
    <section className={`activity ${open ? 'activity-open' : ''}`} aria-label="活動面板">
      <div className="activity-tabs">
        <div>
          <button
            className={open === 'transfers' ? 'active' : ''}
            onClick={() => onToggle('transfers')}
            aria-expanded={open === 'transfers'}
          >
            <ArrowUp size={15} />
            <ArrowDown size={15} className="paired-icon" />
            傳輸佇列{tasks.length > 0 && <span className="count">{running || tasks.length}</span>}
          </button>
          <button
            className={open === 'logs' ? 'active' : ''}
            onClick={() => onToggle('logs')}
            aria-expanded={open === 'logs'}
          >
            <Terminal size={16} />
            除錯紀錄{errors > 0 && <span className="count error-count">{errors}</span>}
          </button>
        </div>
        <span className="activity-hint">
          {running ? (
            <>
              <LoaderCircle className="spin" size={14} />
              {running} 項傳輸中
            </>
          ) : (
            <>
              <span className="status-dot" />
              檔案直接傳輸 · 無中繼伺服器
            </>
          )}
        </span>
        <button
          className="icon-button"
          onClick={() => onToggle(open ?? 'logs')}
          aria-label={open ? '收合活動面板' : '展開活動面板'}
        >
          <ChevronDown size={17} className={open ? '' : 'rotate-180'} />
        </button>
      </div>
      {open === 'logs' && (
        <div className="activity-body">
          <div className="log-toolbar">
            <div className="input-icon">
              <Search size={15} />
              <input
                aria-label="搜尋紀錄"
                placeholder="搜尋方法、路徑或訊息…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <select
              aria-label="紀錄等級"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">所有等級</option>
              <option value="info">成功</option>
              <option value="warning">警告</option>
              <option value="error">錯誤</option>
            </select>
            <span className="grow" />
            <button className="icon-button" title="複製紀錄" aria-label="複製紀錄" onClick={copy}>
              <Clipboard size={16} />
            </button>
            <button
              className="icon-button"
              title="匯出 JSON"
              aria-label="匯出紀錄 JSON"
              onClick={() =>
                saveBlob(
                  new Blob([exportLogs(logs)], { type: 'application/json' }),
                  `webdav-logs-${new Date().toISOString().slice(0, 10)}.json`,
                )
              }
            >
              <Download size={16} />
            </button>
            <button
              className="icon-button"
              title="清除紀錄"
              aria-label="清除紀錄"
              onClick={onClearLogs}
            >
              <Trash2 size={16} />
            </button>
          </div>
          <div className="log-list">
            {filtered.length ? (
              filtered.map((log) => (
                <div className={`log-item log-${log.level}`} key={log.id}>
                  <button
                    className="log-row"
                    onClick={() => setExpanded(expanded === log.id ? undefined : log.id)}
                    aria-expanded={expanded === log.id}
                  >
                    <ChevronRight size={13} className={expanded === log.id ? 'rotate-90' : ''} />
                    <time>{new Date(log.time).toLocaleTimeString('zh-TW', { hour12: false })}</time>
                    <span className="method">{log.method}</span>
                    <span className="log-url">{log.url}</span>
                    <span className={`http-status ${log.level}`}>{log.status ?? '—'}</span>
                    <span className="log-duration">{log.durationMs} ms</span>
                  </button>
                  {expanded === log.id && (
                    <div className="log-detail">
                      <strong>
                        {log.operation} · {log.message}
                      </strong>
                      <pre>
                        {JSON.stringify(
                          {
                            time: log.time,
                            headers: log.headers,
                            ...(log.detail ? { detail: log.detail } : {}),
                          },
                          null,
                          2,
                        )}
                      </pre>
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div className="panel-empty">
                <FileTerminal size={25} />
                <span>
                  {logs.length ? '沒有符合條件的紀錄' : '連線後，每一次請求都會記錄在這裡'}
                </span>
              </div>
            )}
          </div>
          <div className="panel-footnote">
            最近 {logs.length} / 500 筆 · 僅保留於本次頁面 · 密碼與授權資訊已遮蔽
          </div>
        </div>
      )}
      {open === 'transfers' && (
        <div className="activity-body">
          <div className="transfer-heading">
            <span>
              傳輸項目 <span className="muted">{tasks.length}</span>
            </span>
            <button className="text-button" onClick={onClearTasks}>
              清除已結束項目
            </button>
          </div>
          <div className="transfer-list">
            {tasks.length ? (
              tasks.toReversed().map((task) => (
                <div className={`transfer-item transfer-${task.state}`} key={task.id}>
                  <div className="transfer-direction">
                    {task.state === 'done' ? (
                      <Check size={18} />
                    ) : task.state === 'error' ? (
                      <CircleAlert size={18} />
                    ) : task.direction === 'upload' ? (
                      <ArrowUp size={18} />
                    ) : (
                      <ArrowDown size={18} />
                    )}
                  </div>
                  <div className="transfer-info">
                    <div>
                      <strong>{task.name}</strong>
                      <span>
                        {
                          {
                            queued: '等待中',
                            running:
                              task.total !== undefined && task.loaded === task.total
                                ? '等待完成'
                                : '傳輸中',
                            done: '已完成',
                            error: '失敗',
                            cancelled: '已取消',
                          }[task.state]
                        }
                      </span>
                    </div>
                    <div className="progress-track">
                      <div
                        style={{
                          width: `${task.state === 'done' ? 100 : task.total ? Math.min(100, (task.loaded / task.total) * 100) : 0}%`,
                        }}
                      />
                    </div>
                    <small>
                      {task.message ??
                        `${formatBytes(task.loaded)}${task.total !== undefined ? ` / ${formatBytes(task.total)}` : ''}`}
                    </small>
                  </div>
                  {['running', 'queued'].includes(task.state) ? (
                    <button
                      className="icon-button"
                      onClick={() => onCancel(task.id)}
                      aria-label={`取消 ${task.name}`}
                    >
                      <X size={17} />
                    </button>
                  ) : ['error', 'cancelled'].includes(task.state) ? (
                    <button
                      className="icon-button"
                      onClick={() => onRetry(task.id)}
                      aria-label={`重試 ${task.name}`}
                    >
                      <RotateCcw size={17} />
                    </button>
                  ) : (
                    <Check size={17} className="success-text" />
                  )}
                </div>
              ))
            ) : (
              <div className="panel-empty">
                <ArrowDown size={25} />
                <span>上傳或下載檔案後，可在這裡查看進度</span>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
