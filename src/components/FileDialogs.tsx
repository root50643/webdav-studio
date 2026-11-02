import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ChevronRight,
  Download,
  Folder,
  LoaderCircle,
  FolderOpen,
  FileQuestion,
} from 'lucide-react';
import type { DavEntry } from '../types';
import { DavClient } from '../lib/webdav';
import { previewKind } from '../lib/files';
import { displayPath, formatBytes } from '../lib/paths';
import { demoText } from '../lib/demo';
import { InlineError, Modal } from './Modal';

export function PreviewDialog({
  entry,
  client,
  demo,
  onDownload,
  onClose,
}: {
  entry: DavEntry;
  client: DavClient | null;
  demo: boolean;
  onDownload: () => void;
  onClose: () => void;
}) {
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const kind = previewKind(entry);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    async function load() {
      try {
        if (!kind) return;
        const limit = kind === 'image' ? 20 * 1024 * 1024 : 1024 * 1024;
        if (entry.size !== undefined && entry.size > limit)
          throw new Error(`檔案超過 ${limit / 1024 / 1024} MiB 預覽上限，請下載後查看。`);
        const blob = demo
          ? new Blob([demoText(entry)], { type: 'text/plain' })
          : await client!.download(entry, controller.signal, undefined, undefined, limit);
        if (!blob || controller.signal.aborted) return;
        if (kind === 'image') {
          const start = (await blob.slice(0, 512).text()).trimStart();
          if (blob.type.includes('svg') || /<(?:svg|html|!doctype)/i.test(start))
            throw new Error('此檔案包含主動內容，請下載後自行查看。');
          if (controller.signal.aborted) return;
          objectUrl = URL.createObjectURL(blob);
          setContent(objectUrl);
        } else {
          const text = await blob.text();
          if (!controller.signal.aborted) setContent(text);
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : '無法預覽。');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [entry, client, demo, kind]);
  return (
    <Modal
      title={entry.name}
      subtitle={`${formatBytes(entry.size)} · ${kind === 'image' ? '圖片預覽' : kind === 'text' ? '純文字預覽' : '檔案資訊'}`}
      wide
      onClose={onClose}
    >
      <div className={`preview-content ${kind === 'text' ? 'preview-text' : ''}`}>
        {!kind ? (
          <div className="empty-state compact">
            <FileQuestion size={48} />
            <h3>此檔案不提供線上預覽</h3>
            <p>下載到電腦後，使用適合的應用程式開啟。</p>
          </div>
        ) : loading ? (
          <LoaderCircle size={28} className="spin" />
        ) : error ? (
          <InlineError message={error} />
        ) : kind === 'image' ? (
          <img
            src={content}
            alt={entry.name}
            onError={() => setError('無法解碼這張圖片，請下載後使用圖片檢視器開啟。')}
          />
        ) : (
          <pre>{content}</pre>
        )}
      </div>
      <footer className="modal-footer">
        <span className="muted small">預覽內容不會上傳至第三方服務</span>
        <button className="button primary" onClick={onDownload}>
          <Download size={17} />
          下載檔案
        </button>
      </footer>
    </Modal>
  );
}

export function DestinationDialog({
  client,
  operation,
  onSubmit,
  onClose,
}: {
  client: DavClient;
  operation: 'move' | 'copy';
  onSubmit: (path: string) => Promise<void>;
  onClose: () => void;
}) {
  const [path, setPath] = useState(client.root);
  const [entries, setEntries] = useState<DavEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void client
      .list(path, controller.signal)
      .then((entries) => {
        if (!controller.signal.aborted) setEntries(entries.filter((entry) => entry.directory));
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, client]);
  const parent = path.replace(/[^/]+\/$/, '');
  return (
    <Modal
      title={operation === 'move' ? '移動至資料夾' : '複製至資料夾'}
      subtitle="選擇同一台主機中的目的地。現有檔案不會被覆寫。"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="destination-path">
        <button
          className="icon-button"
          disabled={path === client.root || loading || busy}
          onClick={() => setPath(parent)}
          aria-label="上一層資料夾"
        >
          <ArrowLeft size={18} />
        </button>
        <FolderOpen size={18} />
        <span>{displayPath(path.slice(client.root.length)) || '根目錄'}</span>
      </div>
      <div className="destination-list">
        {loading ? (
          <div className="centered">
            <LoaderCircle className="spin" />
          </div>
        ) : entries.length ? (
          entries.map((entry) => (
            <button key={entry.path} disabled={busy} onClick={() => setPath(entry.path)}>
              <Folder size={20} />
              <span>{entry.name}</span>
              <ChevronRight size={17} />
            </button>
          ))
        ) : (
          <p className="muted centered">此資料夾沒有子資料夾</p>
        )}
      </div>
      <InlineError message={error} />
      <footer className="modal-footer">
        <button className="button secondary" disabled={busy} onClick={onClose}>
          取消
        </button>
        <button
          className="button primary"
          disabled={loading || busy || !!error}
          onClick={async () => {
            setBusy(true);
            try {
              await onSubmit(path);
            } catch (error) {
              setError(error instanceof Error ? error.message : '操作失敗');
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <LoaderCircle className="spin" size={17} />}選擇此資料夾
        </button>
      </footer>
    </Modal>
  );
}
