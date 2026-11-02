import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Cloud,
  CloudUpload,
  Code2,
  Copy,
  ExternalLink,
  File,
  FileArchive,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  Grid2X2,
  HardDrive,
  HelpCircle,
  Home,
  KeyRound,
  LayoutList,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Menu,
  Moon,
  MoreHorizontal,
  MoveRight,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Terminal,
  Trash2,
  Upload,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import type { ConnectionProfile, DavEntry, RequestLog, TransferTask } from './types';
import { DavClient } from './lib/webdav';
import { appendLog } from './lib/logger';
import { childPath, displayPath, formatBytes, formatDate, scopedUrl } from './lib/paths';
import {
  createSession,
  decryptProfiles,
  encryptProfiles,
  readVault,
  writeVault,
  type VaultSession,
} from './lib/vault';
import { TransferQueue } from './lib/transfers';
import { entryType, filePicker, previewKind, saveBlob } from './lib/files';
import { demoEntries, demoText } from './lib/demo';
import { Modal, InlineError } from './components/Modal';
import { ConnectionDialog } from './components/ConnectionDialog';
import { VaultDialog, type VaultMode } from './components/VaultDialog';
import { DestinationDialog, PreviewDialog } from './components/FileDialogs';
import { ActivityPanels } from './components/ActivityPanels';

type Operation = { kind: 'mkdir' | 'rename' | 'delete' | 'move' | 'copy'; items: DavEntry[] };
type VaultState = 'loading' | 'empty' | 'locked' | 'unlocked' | 'unavailable';
function getRoute(): { id: string; path: string } | undefined {
  const match = /^#\/([^/]+)\/(.*)$/.exec(location.hash);
  if (!match) return;
  try {
    return { id: decodeURIComponent(match[1]), path: decodeURIComponent(match[2]) };
  } catch {
    return;
  }
}
function setRoute(id: string, path: string, replace = false) {
  history[replace ? 'replaceState' : 'pushState'](
    null,
    '',
    `#/${encodeURIComponent(id)}/${encodeURIComponent(path)}`,
  );
}
export function FileIcon({ entry, large = false }: { entry: DavEntry; large?: boolean }) {
  const extension = entry.name.split('.').pop()?.toLowerCase();
  const kind = entry.directory
    ? 'folder'
    : previewKind(entry) === 'image'
      ? 'image'
      : extension === 'pdf'
        ? 'pdf'
        : ['json', 'js', 'ts', 'css', 'yaml'].includes(extension ?? '')
          ? 'code'
          : extension === 'zip'
            ? 'archive'
            : 'text';
  const Icon = {
    folder: Folder,
    image: FileImage,
    pdf: FileText,
    code: Code2,
    archive: FileArchive,
    text: FileText,
  }[kind];
  return (
    <span className={`file-icon file-icon-${kind} ${large ? 'file-icon-large' : ''}`}>
      <Icon
        size={large ? 38 : 21}
        strokeWidth={1.6}
        fill={kind === 'folder' ? 'currentColor' : 'none'}
      />
    </span>
  );
}

export default function App() {
  const [vaultState, setVaultState] = useState<VaultState>('loading');
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const session = useRef<VaultSession | null>(null);
  const [vaultDialog, setVaultDialog] = useState<VaultMode>();
  const afterUnlock = useRef<(() => void) | null>(null);
  const [connectionDialog, setConnectionDialog] = useState<ConnectionProfile | 'new'>();
  const [removeProfile, setRemoveProfile] = useState<ConnectionProfile>();
  const [activeProfile, setActiveProfile] = useState<ConnectionProfile | null>(null);
  const client = useRef<DavClient | null>(null);
  const listingController = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const currentPath = useRef('');
  const workspaceRef = useRef<HTMLElement>(null);
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<DavEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [demo, setDemo] = useState(false);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'list' | 'grid'>(() => {
    try {
      return localStorage.getItem('webdav-studio-view') === 'grid' ? 'grid' : 'list';
    } catch {
      return 'list';
    }
  });
  const [sort, setSort] = useState<'name' | 'size' | 'modified' | 'type'>('name');
  const [ascending, setAscending] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [logs, setLogs] = useState<RequestLog[]>([]);
  const [tasks, setTasks] = useState<TransferTask[]>([]);
  const [panel, setPanel] = useState<'logs' | 'transfers' | null>(null);
  const queue = useRef<TransferQueue | null>(null);
  if (!queue.current) queue.current = new TransferQueue(setTasks);
  const [sidebar, setSidebar] = useState(false);
  const [settings, setSettings] = useState(false);
  const [help, setHelp] = useState(false);
  const [theme, setTheme] = useState(document.documentElement.dataset.theme ?? 'light');
  const [toast, setToast] = useState<{ message: string; id: number }>();
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const uploadInput = useRef<HTMLInputElement>(null);
  const [operation, setOperation] = useState<Operation>();
  const [operationValue, setOperationValue] = useState('');
  const [operationError, setOperationError] = useState('');
  const [operationBusy, setOperationBusy] = useState(false);
  const [preview, setPreview] = useState<DavEntry>();
  const [rowMenu, setRowMenu] = useState<{ entry: DavEntry; x: number; y: number }>();
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!rowMenu) return;
    const previous = document.activeElement as HTMLElement | null;
    const items = Array.from(menuRef.current!.querySelectorAll<HTMLButtonElement>('button'));
    items[0]?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        if (event.key === 'Escape') event.preventDefault();
        setRowMenu(undefined);
      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? items.length - 1
              : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }
    };
    document.addEventListener('keydown', handle);
    return () => {
      document.removeEventListener('keydown', handle);
      if (previous?.isConnected) previous.focus();
    };
  }, [rowMenu]);
  const [conflict, setConflict] = useState<{
    name: string;
    resolve: (answer: 'overwrite' | 'skip' | 'cancel') => void;
  }>();
  const conflictRef = useRef<typeof conflict>(undefined);
  conflictRef.current = conflict;

  function notify(message: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, id: Date.now() });
    toastTimer.current = setTimeout(() => setToast(undefined), 6000);
  }
  function addLog(log: RequestLog) {
    setLogs((old) => appendLog(old, log));
  }

  useEffect(() => {
    let alive = true;
    void readVault()
      .then((value) => {
        if (alive) setVaultState(value ? 'locked' : 'empty');
      })
      .catch((error) => {
        if (alive) {
          setVaultState('unavailable');
          notify(error.message);
        }
      });
    return () => {
      alive = false;
      client.current?.abortAll();
      queue.current?.reset();
      listingController.current?.abort();
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  function resetConnection() {
    if (workspaceRef.current) workspaceRef.current.scrollTop = 0;
    generation.current++;
    listingController.current?.abort();
    client.current?.abortAll();
    client.current = null;
    queue.current!.reset();
    conflictRef.current?.resolve('cancel');
    setConflict(undefined);
    setPreview(undefined);
    setRowMenu(undefined);
    setEntries([]);
    setSelected(new Set());
    setConnectionError('');
    setConnected(false);
    setLoading(false);
    setQuery('');
    setOperation(undefined);
  }
  async function loadDirectory(next: string, connection = client.current) {
    if (!connection || connection !== client.current) return;
    try {
      scopedUrl(connection.base, next);
    } catch (error) {
      notify((error as Error).message);
      return;
    }
    listingController.current?.abort();
    const controller = new AbortController();
    listingController.current = controller;
    const id = generation.current;
    currentPath.current = next;
    setPath(next);
    setLoading(true);
    setSelected(new Set());
    setQuery('');
    setConnectionError('');
    setEntries([]);
    try {
      const items = await connection.list(next, controller.signal);
      if (id === generation.current && !controller.signal.aborted) {
        setEntries(items);
        setConnected(true);
      }
    } catch (error) {
      if (id === generation.current && !controller.signal.aborted) {
        setConnectionError((error as Error).message);
        setConnected(false);
        setPanel('logs');
      }
    } finally {
      if (id === generation.current && !controller.signal.aborted) setLoading(false);
    }
  }
  function connectProfile(profile: ConnectionProfile, routePath?: string) {
    resetConnection();
    setDemo(false);
    setActiveProfile(profile);
    setSidebar(false);
    try {
      const epoch = generation.current;
      const connection = new DavClient(profile, (log) => {
        if (epoch === generation.current) addLog(log);
      });
      client.current = connection;
      let next = connection.root;
      if (routePath) {
        try {
          next = scopedUrl(connection.base, routePath).pathname;
        } catch {
          notify('已返回此連線的根目錄。');
        }
      }
      setRoute(profile.id, next, true);
      void loadDirectory(next, connection);
    } catch (error) {
      setConnectionError((error as Error).message);
    }
  }
  function startDemo(next = '/demo/') {
    resetConnection();
    setActiveProfile(null);
    setDemo(true);
    setSidebar(false);
    const valid =
      next === '/demo/' || demoEntries.some((entry) => entry.directory && entry.path === next);
    const demoPath = valid ? next : '/demo/';
    currentPath.current = demoPath;
    setPath(demoPath);
    setEntries(demoPath === '/demo/' ? demoEntries : []);
    setRoute('demo', demoPath, true);
  }
  function navigate(next: string) {
    if (workspaceRef.current) workspaceRef.current.scrollTop = 0;
    if (demo) {
      setSelected(new Set());
      setQuery('');
      currentPath.current = next;
      setPath(next);
      setEntries(next === '/demo/' ? demoEntries : []);
      setRoute('demo', next);
    } else if (activeProfile) {
      setRoute(activeProfile.id, next);
      void loadDirectory(next);
    }
  }
  useEffect(() => {
    const handle = () => {
      const route = getRoute();
      if (!route) return;
      if (route.id === 'demo') {
        startDemo(route.path);
        return;
      }
      const profile = profiles.find((profile) => profile.id === route.id);
      if (profile) {
        if (client.current?.profile.id === route.id) void loadDirectory(route.path);
        else connectProfile(profile, route.path);
      } else if (vaultState === 'locked') setVaultDialog('unlock');
    };
    window.addEventListener('hashchange', handle);
    return () => window.removeEventListener('hashchange', handle);
  }, [profiles, vaultState]);
  useEffect(() => {
    if (getRoute()?.id === 'demo') startDemo(getRoute()!.path);
  }, []);

  function ensureUnlocked(action: () => void) {
    if (vaultState === 'unlocked') {
      action();
      return;
    }
    if (vaultState === 'loading') {
      notify('正在開啟本機密碼庫，請稍候。');
      return;
    }
    if (vaultState === 'unavailable') {
      notify('本機儲存空間不可用，請允許此網站使用 IndexedDB 並重新整理。');
      return;
    }
    afterUnlock.current = action;
    setVaultDialog(vaultState === 'empty' ? 'create' : 'unlock');
  }
  function addConnection() {
    ensureUnlocked(() => setConnectionDialog('new'));
  }
  async function handleVault(password: string, newPassword?: string) {
    const envelope = await readVault();
    if (vaultDialog === 'create') {
      if (envelope) throw new Error('密碼庫已在另一個分頁建立，請重新整理後解鎖。');
      const next = await createSession(password);
      await writeVault(await encryptProfiles([], next));
      session.current = next;
      setProfiles([]);
      setVaultState('unlocked');
    } else if (vaultDialog === 'change') {
      if (!envelope || !newPassword) throw new Error('找不到密碼庫，請重新整理後再試。');
      await decryptProfiles(envelope, password);
      const next = await createSession(newPassword);
      await writeVault(await encryptProfiles(profiles, next));
      session.current = next;
      notify('主密碼已更新，連線設定已重新加密。');
    } else {
      if (!envelope) throw new Error('找不到密碼庫，請重新整理後建立。');
      const result = await decryptProfiles(envelope, password);
      session.current = result.session;
      setProfiles(result.profiles);
      setVaultState('unlocked');
      const route = getRoute();
      if (route) {
        const profile = result.profiles.find((profile) => profile.id === route.id);
        if (profile) connectProfile(profile, route.path);
      }
    }
    setVaultDialog(undefined);
    const pending = afterUnlock.current;
    afterUnlock.current = null;
    pending?.();
  }
  function lockVault() {
    resetConnection();
    session.current = null;
    setProfiles([]);
    setActiveProfile(null);
    setDemo(false);
    setPath('');
    currentPath.current = '';
    setVaultState('locked');
    setSettings(false);
    setConnectionDialog(undefined);
    setVaultDialog(undefined);
    afterUnlock.current = null;
    setLogs([]);
    notify('密碼庫已鎖定，連線與傳輸已中止。');
  }
  async function saveProfiles(next: ConnectionProfile[]) {
    if (!session.current) throw new Error('請先解鎖密碼庫。');
    await writeVault(await encryptProfiles(next, session.current));
    setProfiles(next);
  }
  async function saveProfile(profile: ConnectionProfile) {
    const next = profiles.some((item) => item.id === profile.id)
      ? profiles.map((item) => (item.id === profile.id ? profile : item))
      : [...profiles, profile];
    await saveProfiles(next);
    setConnectionDialog(undefined);
    notify('連線設定已加密保存。');
    connectProfile(profile);
  }
  async function testProfile(profile: ConnectionProfile, signal: AbortSignal) {
    const epoch = generation.current;
    const connection = new DavClient(profile, (log) => {
      if (epoch === generation.current) addLog(log);
    });
    try {
      await connection.list(connection.root, signal);
      try {
        await connection.options(signal);
      } catch {
        /* OPTIONS is advisory; PROPFIND establishes connectivity. */
      }
    } finally {
      connection.abortAll();
    }
  }
  function switchTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('webdav-studio-theme', next);
    } catch {
      /* preferences are optional */
    }
  }
  function changeView(next: 'list' | 'grid') {
    setView(next);
    try {
      localStorage.setItem('webdav-studio-view', next);
    } catch {
      /* preferences are optional */
    }
  }

  const sorted = useMemo(
    () =>
      entries
        .filter((entry) => entry.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
        .sort((a, b) => {
          if (a.directory !== b.directory) return a.directory ? -1 : 1;
          const value =
            sort === 'size'
              ? (a.size ?? -1) - (b.size ?? -1)
              : sort === 'modified'
                ? (Date.parse(a.modified ?? '') || 0) - (Date.parse(b.modified ?? '') || 0)
                : sort === 'type'
                  ? entryType(a).localeCompare(entryType(b), 'zh-TW')
                  : a.name.localeCompare(b.name, 'zh-TW', { numeric: true });
          return ascending ? value : -value;
        }),
    [entries, query, sort, ascending],
  );
  const chosen = entries.filter((entry) => selected.has(entry.path));
  const folders = entries.filter((entry) => entry.directory);
  const hasWorkspace = demo || !!activeProfile;
  const canManage = connected && !demo;
  const root = demo ? '/demo/' : (client.current?.root ?? '/');
  const relativeParts = path.startsWith(root)
    ? path.slice(root.length).split('/').filter(Boolean)
    : [];

  function select(entry: DavEntry, additive: boolean) {
    setSelected((old) => {
      if (!additive) return new Set([entry.path]);
      const next = new Set(old);
      if (next.has(entry.path)) next.delete(entry.path);
      else next.add(entry.path);
      return next;
    });
  }
  function beginOperation(kind: Operation['kind'], items = chosen) {
    setRowMenu(undefined);
    if (!canManage) {
      notify(
        demo
          ? '目前是唯讀互動範例。新增連線後即可管理自己的檔案。'
          : '請先成功連線至 WebDAV 主機。',
      );
      return;
    }
    setOperation({ kind, items });
    setOperationValue(kind === 'rename' ? (items[0]?.name ?? '') : '');
    setOperationError('');
  }
  async function submitOperation(event?: FormEvent, destination?: string) {
    event?.preventDefault();
    const connection = client.current;
    if (!operation || !connection) return;
    const epoch = generation.current;
    setOperationBusy(true);
    setOperationError('');
    try {
      if (operation.kind === 'mkdir')
        await connection.mkdir(childPath(currentPath.current, operationValue, true));
      else if (operation.kind === 'rename') {
        const entry = operation.items[0];
        await connection.move(
          entry.path,
          childPath(currentPath.current, operationValue, entry.directory),
        );
      } else {
        const failures: string[] = [];
        const failedEntries: DavEntry[] = [];
        let done = 0;
        for (const entry of operation.items) {
          if (epoch !== generation.current) return;
          try {
            if (operation.kind === 'delete') await connection.delete(entry.path);
            else {
              const target = childPath(destination!, entry.name, entry.directory);
              if (operation.kind === 'move') await connection.move(entry.path, target);
              else await connection.copy(entry.path, target);
            }
            done++;
          } catch (error) {
            failures.push(`${entry.name}：${(error as Error).message}`);
            failedEntries.push(entry);
          }
        }
        if (failures.length) {
          // Keep only failed items so retrying cannot repeat successful destructive operations.
          setOperation({ ...operation, items: failedEntries });
          if (done) void loadDirectory(currentPath.current, connection);
          throw new Error(`${done} 項完成，${failures.length} 項失敗。\n${failures.join('\n')}`);
        }
      }
      if (epoch !== generation.current) return;
      setOperation(undefined);
      notify('操作完成。');
      void loadDirectory(currentPath.current, connection);
    } catch (error) {
      if (epoch === generation.current) {
        setOperationError((error as Error).message);
        throw error;
      }
    } finally {
      setOperationBusy(false);
    }
  }
  async function download(entry: DavEntry) {
    setRowMenu(undefined);
    if (entry.directory) {
      notify('第一版支援單檔下載；資料夾請先開啟後選擇檔案。');
      return;
    }
    if (demo) {
      if (previewKind(entry) === 'text')
        saveBlob(new Blob([demoText(entry)], { type: 'text/plain' }), entry.name);
      else notify('這是示意檔案。連線主機後即可下載實際檔案。');
      return;
    }
    const connection = client.current;
    if (!connection || !connected) {
      notify('請先連線至主機。');
      return;
    }
    const epoch = generation.current;
    try {
      const picker = filePicker();
      const handle = picker ? await picker({ suggestedName: entry.name }) : undefined;
      if (epoch !== generation.current) return;
      queue.current!.add(
        entry.name,
        'download',
        async (signal, progress) => {
          const sink = handle ? await handle.createWritable() : undefined;
          if (signal.aborted) {
            await sink?.abort();
            signal.throwIfAborted();
          }
          const blob = await connection.download(entry, signal, progress, sink);
          if (blob && !signal.aborted) saveBlob(blob, entry.name);
        },
        entry.size,
      );
      setPanel('transfers');
    } catch (error) {
      if ((error as Error).name !== 'AbortError') notify((error as Error).message);
    }
  }
  function openEntry(entry: DavEntry) {
    setRowMenu(undefined);
    if (entry.directory) navigate(entry.path);
    else setPreview(entry);
  }
  async function uploadFiles(files: File[]) {
    if (!canManage || !client.current) {
      notify('請先新增連線，才能上傳檔案。');
      return;
    }
    const connection = client.current,
      folderPath = currentPath.current,
      epoch = generation.current;
    const names = new Set(entries.map((entry) => entry.name));
    for (const file of files) {
      let overwrite = false;
      if (entries.some((entry) => entry.name === file.name && entry.directory)) {
        notify(`已跳過 ${file.name}：同名資料夾已存在。`);
        continue;
      }
      if (names.has(file.name)) {
        const answer = await new Promise<'overwrite' | 'skip' | 'cancel'>((resolve) =>
          setConflict({ name: file.name, resolve }),
        );
        setConflict(undefined);
        if (answer === 'cancel' || epoch !== generation.current) return;
        if (answer === 'skip') continue;
        overwrite = true;
      }
      if (epoch !== generation.current) return;
      try {
        const target = childPath(folderPath, file.name);
        queue.current!.add(
          file.name,
          'upload',
          async (signal, progress) => {
            await connection.upload(target, file, overwrite, signal, progress);
            if (epoch === generation.current && currentPath.current === folderPath)
              void loadDirectory(folderPath, connection);
          },
          file.size,
        );
        names.add(file.name);
        setPanel('transfers');
      } catch (error) {
        notify((error as Error).message);
      }
    }
  }
  function handleSort(next: typeof sort) {
    if (sort === next) setAscending(!ascending);
    else {
      setSort(next);
      setAscending(true);
    }
  }
  const sortLabel = { name: '名稱', size: '大小', modified: '修改日期', type: '類型' };

  return (
    <div className="app-shell">
      {sidebar && (
        <button className="sidebar-scrim" onClick={() => setSidebar(false)} aria-label="關閉側欄" />
      )}
      <aside className={`sidebar ${sidebar ? 'sidebar-visible' : ''}`}>
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            if (hasWorkspace) navigate(root);
          }}
        >
          <span className="brand-icon">
            <CloudUpload size={25} strokeWidth={1.8} />
          </span>
          <span>
            WebDAV<span className="brand-studio">Studio</span>
          </span>
        </a>
        <button className="button primary new-connection" onClick={addConnection}>
          <Plus size={20} />
          新增連線
        </button>
        <div className="nav-caption">工作空間</div>
        <button
          className={`nav-item ${hasWorkspace ? 'selected' : ''}`}
          onClick={() =>
            hasWorkspace ? navigate(root) : notify('新增連線，或瀏覽互動範例以開始使用。')
          }
        >
          <FolderOpen size={19} />
          <span>我的檔案</span>
          {hasWorkspace && <ChevronRight size={15} />}
        </button>
        <button
          className={`nav-item ${panel === 'transfers' ? 'selected-soft' : ''}`}
          onClick={() => {
            setPanel(panel === 'transfers' ? null : 'transfers');
            setSidebar(false);
          }}
        >
          <ArrowDownToLine size={19} />
          <span>傳輸佇列</span>
          {tasks.filter((task) => task.state === 'running').length > 0 && (
            <span className="count">{tasks.filter((task) => task.state === 'running').length}</span>
          )}
        </button>
        <button
          className={`nav-item ${panel === 'logs' ? 'selected-soft' : ''}`}
          onClick={() => {
            setPanel(panel === 'logs' ? null : 'logs');
            setSidebar(false);
          }}
        >
          <Terminal size={19} />
          <span>除錯紀錄</span>
        </button>
        <div className="sidebar-divider" />
        <div className="nav-caption connection-caption">
          <span>已儲存的連線</span>
          <button className="icon-button" aria-label="新增已儲存連線" onClick={addConnection}>
            <Plus size={15} />
          </button>
        </div>
        <div className="connection-list">
          {vaultState === 'unlocked' ? (
            profiles.length ? (
              profiles.map((profile) => (
                <div
                  className={`profile-item ${activeProfile?.id === profile.id ? 'profile-active' : ''}`}
                  key={profile.id}
                >
                  <button
                    className="profile-main"
                    onClick={() => connectProfile(profile)}
                    title={profile.baseUrl}
                  >
                    <span className="profile-avatar">
                      <HardDrive size={17} />
                    </span>
                    <span>
                      <strong>{profile.name}</strong>
                      <small>{new URL(profile.baseUrl).hostname}</small>
                    </span>
                    {activeProfile?.id === profile.id && (
                      <span className={`status-dot ${connected ? '' : 'offline'}`} />
                    )}
                  </button>
                  <div className="profile-tools">
                    <button
                      className="icon-button"
                      onClick={() => setConnectionDialog(profile)}
                      aria-label={`編輯 ${profile.name}`}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      className="icon-button"
                      onClick={() => setRemoveProfile(profile)}
                      aria-label={`移除 ${profile.name}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="sidebar-empty">
                <HardDrive size={22} />
                <p>還沒有連線</p>
                <small>把常用的主機加進來吧</small>
              </div>
            )
          ) : (
            <button className="vault-sidebar" onClick={() => ensureUnlocked(() => {})}>
              <LockKeyhole size={20} />
              <span>
                {vaultState === 'loading'
                  ? '開啟密碼庫中…'
                  : vaultState === 'empty'
                    ? '建立加密密碼庫'
                    : vaultState === 'unavailable'
                      ? '本機儲存空間不可用'
                      : '密碼庫已鎖定'}
                <small>
                  {vaultState === 'empty' ? '安全保存你的連線資訊' : '解鎖後顯示連線資訊'}
                </small>
              </span>
              {vaultState !== 'loading' && <ChevronRight size={14} />}
            </button>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="privacy-card">
            <span className="privacy-icon">
              <ShieldCheck size={21} />
            </span>
            <strong>你的檔案，由你掌握</strong>
            <p>
              直接連接你的主機
              <br />
              連線資訊只在本機加密保存
            </p>
            <span className="local-badge">
              <span className="status-dot" />
              100% 純前端
            </span>
          </div>
          <button
            className="nav-item"
            onClick={() => {
              setHelp(true);
              setSidebar(false);
            }}
          >
            <HelpCircle size={18} />
            <span>使用說明</span>
            <ExternalLink size={13} />
          </button>
          <div className="sidebar-footer">
            <span>WebDAV Studio</span>
            <span>v1.0</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            onClick={() => setSidebar(true)}
            aria-label="開啟側欄"
          >
            <Menu size={21} />
          </button>
          <div className="global-search">
            <Search size={19} />
            <input
              aria-label="搜尋目前資料夾"
              placeholder="搜尋目前資料夾的檔案…"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelected(new Set());
              }}
              disabled={!hasWorkspace}
            />
            <span className="search-hint">搜尋檔名</span>
            {query && (
              <button className="icon-button" aria-label="清除搜尋" onClick={() => setQuery('')}>
                <X size={15} />
              </button>
            )}
          </div>
          <div className="topbar-actions">
            <span className={`connection-badge ${connected ? 'is-connected' : ''}`}>
              {demo ? (
                <Sparkles size={14} />
              ) : connected ? (
                <Wifi size={14} />
              ) : (
                <WifiOff size={14} />
              )}
              <span>{demo ? '互動範例' : connected ? '已連線' : '尚未連線'}</span>
            </span>
            <span className="topbar-separator" />
            <button
              className="icon-button"
              title={theme === 'light' ? '切換深色模式' : '切換淺色模式'}
              aria-label={theme === 'light' ? '切換深色模式' : '切換淺色模式'}
              onClick={switchTheme}
            >
              {theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}
            </button>
            <button
              className="icon-button"
              aria-label="設定"
              title="設定"
              onClick={() => setSettings(true)}
            >
              <Settings2 size={19} />
            </button>
            <button
              className={`vault-status-button ${vaultState === 'unlocked' ? 'unlocked' : ''}`}
              title={vaultState === 'unlocked' ? '鎖定密碼庫' : '解鎖密碼庫'}
              aria-label={vaultState === 'unlocked' ? '鎖定密碼庫' : '解鎖密碼庫'}
              onClick={() => (vaultState === 'unlocked' ? lockVault() : ensureUnlocked(() => {}))}
            >
              <LockKeyhole size={18} />
            </button>
          </div>
        </header>
        <main
          ref={workspaceRef}
          className={`workspace ${dragging ? 'is-dragging' : ''}`}
          onDragEnter={(event) => {
            event.preventDefault();
            if (event.dataTransfer.types.includes('Files')) {
              dragDepth.current++;
              setDragging(true);
            }
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            event.preventDefault();
            dragDepth.current--;
            if (dragDepth.current <= 0) {
              dragDepth.current = 0;
              setDragging(false);
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            dragDepth.current = 0;
            if (
              Array.from(event.dataTransfer.items).some(
                (item) => item.webkitGetAsEntry?.()?.isDirectory,
              )
            ) {
              notify('目前支援檔案上傳，請開啟資料夾後選取檔案。');
              return;
            }
            void uploadFiles(Array.from(event.dataTransfer.files));
          }}
        >
          <div className="workspace-heading">
            <div>
              <div className="eyebrow">YOUR PERSONAL CLOUD</div>
              <h1>
                我的檔案<span className="heading-dot">.</span>
              </h1>
              <p>
                {hasWorkspace
                  ? demo
                    ? '先體驗一下，讓你的雲端工作更順手。'
                    : '你的檔案，井然有序。'
                  : '一個簡單、私密的空間，管理你的雲端檔案。'}
              </p>
            </div>
            <div className="heading-actions">
              {hasWorkspace && (
                <button
                  className="button secondary folder-button"
                  onClick={() => beginOperation('mkdir')}
                  disabled={!canManage}
                >
                  <Plus size={17} />
                  新增資料夾
                </button>
              )}
              <button
                className="button primary"
                onClick={() => (canManage ? uploadInput.current?.click() : addConnection())}
              >
                <Upload size={17} />
                {canManage ? '上傳檔案' : '連接我的主機'}
              </button>
            </div>
          </div>
          {!hasWorkspace ? (
            <>
              <section className="welcome-banner">
                <div className="welcome-copy">
                  <span className="welcome-tag">
                    <span className="status-dot" />
                    你的主機，你的工作空間
                  </span>
                  <h2>
                    熟悉的檔案管理，
                    <br />
                    多一點自由。
                  </h2>
                  <p>
                    連上你的 WebDAV 主機，輕鬆瀏覽、傳輸與整理檔案。
                    <br className="desktop-break" />
                    從第一份文件，到每一個重要專案。
                  </p>
                  <div className="welcome-actions">
                    <button className="button primary" onClick={addConnection}>
                      <Plus size={17} />
                      新增第一個連線
                      <ArrowRight size={17} />
                    </button>
                    <button className="button ghost" onClick={() => startDemo()}>
                      瀏覽互動範例
                      <ArrowRight size={16} />
                    </button>
                  </div>
                </div>
                <div className="cloud-illustration" aria-hidden="true">
                  <div className="illustration-orbit orbit-one" />
                  <div className="illustration-orbit orbit-two" />
                  <div className="illustration-cloud">
                    <Cloud size={96} strokeWidth={1.2} />
                    <span className="illustration-check">
                      <Check size={19} />
                    </span>
                  </div>
                  <div className="floating-file float-one">
                    <FileText size={25} />
                    <span>文件</span>
                  </div>
                  <div className="floating-file float-two">
                    <FileImage size={25} />
                    <span>靈感</span>
                  </div>
                  <div className="floating-folder">
                    <Folder size={45} fill="currentColor" strokeWidth={1} />
                  </div>
                  <span className="illustration-dot dot-one" />
                  <span className="illustration-dot dot-two" />
                </div>
              </section>
              <section className="feature-grid">
                <article>
                  <span className="feature-icon blue">
                    <CloudUpload size={21} />
                  </span>
                  <div>
                    <h3>直接連線，輕鬆傳輸</h3>
                    <p>
                      拖放上傳、即時查看進度。
                      <br />
                      檔案直達你的主機。
                    </p>
                  </div>
                </article>
                <article>
                  <span className="feature-icon green">
                    <ShieldCheck size={21} />
                  </span>
                  <div>
                    <h3>連線資訊，加密保存</h3>
                    <p>
                      一組主密碼，管理多台主機。
                      <br />
                      私密設定留在你的瀏覽器。
                    </p>
                  </div>
                </article>
                <article>
                  <span className="feature-icon purple">
                    <Terminal size={21} />
                  </span>
                  <div>
                    <h3>每次請求，都有跡可循</h3>
                    <p>
                      完整狀態、耗時與錯誤紀錄。
                      <br />
                      連線除錯更有方向。
                    </p>
                  </div>
                </article>
              </section>
              <section className="getting-started">
                <div className="section-heading">
                  <h2>準備好，開始你的工作空間</h2>
                  <span>只需要 3 個步驟</span>
                </div>
                <div className="steps">
                  <div>
                    <span>01</span>
                    <strong>建立本機密碼庫</strong>
                    <p>使用主密碼保護連線資訊</p>
                  </div>
                  <ChevronRight size={17} />
                  <div>
                    <span>02</span>
                    <strong>新增 WebDAV 主機</strong>
                    <p>填入網址、帳號與密碼</p>
                  </div>
                  <ChevronRight size={17} />
                  <div>
                    <span>03</span>
                    <strong>開始管理檔案</strong>
                    <p>瀏覽、上傳與下載，一次到位</p>
                  </div>
                </div>
              </section>
              <div className="workspace-footnote">
                <LockKeyhole size={13} />
                不需要註冊帳號，也不會代管你的檔案。
                <button className="text-button" onClick={() => setHelp(true)}>
                  瞭解連線需求
                  <ArrowRight size={13} />
                </button>
              </div>
            </>
          ) : (
            <>
              <div className={`connection-strip ${demo ? 'demo-strip' : ''}`}>
                <span className="connection-strip-icon">
                  {demo ? <Sparkles size={19} /> : <HardDrive size={19} />}
                </span>
                <div>
                  <strong>{demo ? '歡迎來到你的範例工作空間' : activeProfile?.name}</strong>
                  <span>
                    {demo
                      ? '這裡的檔案僅供體驗。新增連線，開始管理自己的檔案。'
                      : activeProfile?.baseUrl}
                  </span>
                </div>
                {demo ? (
                  <button className="text-button" onClick={addConnection}>
                    新增連線
                    <ArrowRight size={15} />
                  </button>
                ) : (
                  <span className="secure-label">
                    <ShieldCheck size={15} />
                    本機加密保存
                  </span>
                )}
              </div>
              {!query && folders.length > 0 && path === root && (
                <section className="quick-folders">
                  <div className="section-heading">
                    <h2>資料夾</h2>
                    <span>{folders.length} 個資料夾</span>
                  </div>
                  <div className="folder-cards">
                    {folders.slice(0, 4).map((entry, index) => (
                      <button
                        className={`folder-card folder-color-${index % 4}`}
                        key={entry.path}
                        onClick={() => openEntry(entry)}
                      >
                        <FileIcon entry={entry} />
                        <div>
                          <strong>{entry.name}</strong>
                          <span>{formatDate(entry.modified)}</span>
                        </div>
                        <ChevronRight size={17} />
                      </button>
                    ))}
                  </div>
                </section>
              )}
              <section className="file-section">
                <div className="file-toolbar">
                  <div className="breadcrumbs">
                    <button onClick={() => navigate(root)} aria-label="根目錄">
                      <Home size={16} />
                    </button>
                    <ChevronRight size={13} />
                    <button
                      className={!relativeParts.length ? 'current' : ''}
                      onClick={() => navigate(root)}
                    >
                      所有檔案
                    </button>
                    {relativeParts.map((part, index) => (
                      <span key={index}>
                        <ChevronRight size={13} />
                        <button
                          className={index === relativeParts.length - 1 ? 'current' : ''}
                          onClick={() =>
                            navigate(`${root}${relativeParts.slice(0, index + 1).join('/')}/`)
                          }
                        >
                          {displayPath(part)}
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="view-controls">
                    <button
                      className="icon-button"
                      title="重新整理"
                      aria-label="重新整理檔案"
                      disabled={loading}
                      onClick={() => (demo ? navigate(path) : void loadDirectory(path))}
                    >
                      <RefreshCw size={17} className={loading ? 'spin' : ''} />
                    </button>
                    <span className="control-separator" />
                    <button
                      className={`icon-button ${view === 'list' ? 'active' : ''}`}
                      title="清單檢視"
                      aria-label="清單檢視"
                      aria-pressed={view === 'list'}
                      onClick={() => changeView('list')}
                    >
                      <LayoutList size={18} />
                    </button>
                    <button
                      className={`icon-button ${view === 'grid' ? 'active' : ''}`}
                      title="網格檢視"
                      aria-label="網格檢視"
                      aria-pressed={view === 'grid'}
                      onClick={() => changeView('grid')}
                    >
                      <Grid2X2 size={17} />
                    </button>
                  </div>
                </div>
                {selected.size > 0 && (
                  <div className="selection-bar">
                    <button
                      className="icon-button"
                      onClick={() => setSelected(new Set())}
                      aria-label="清除選取"
                    >
                      <X size={16} />
                    </button>
                    <strong>已選取 {selected.size} 項</strong>
                    <div className="grow" />
                    {chosen.length === 1 && !chosen[0].directory && (
                      <button
                        className="icon-button"
                        aria-label="下載選取檔案"
                        title="下載"
                        onClick={() => void download(chosen[0])}
                      >
                        <ArrowDownToLine size={17} />
                      </button>
                    )}
                    {chosen.length === 1 && (
                      <button
                        className="icon-button"
                        aria-label="重新命名選取項目"
                        title="重新命名"
                        onClick={() => beginOperation('rename')}
                      >
                        <Pencil size={16} />
                      </button>
                    )}
                    <button
                      className="icon-button"
                      aria-label="移動選取項目"
                      title="移動"
                      onClick={() => beginOperation('move')}
                    >
                      <MoveRight size={17} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label="複製選取項目"
                      title="複製"
                      onClick={() => beginOperation('copy')}
                    >
                      <Copy size={16} />
                    </button>
                    <button
                      className="icon-button danger-text"
                      aria-label="刪除選取項目"
                      title="刪除"
                      onClick={() => beginOperation('delete')}
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                )}
                {connectionError ? (
                  <div className="connection-error">
                    <span className="error-icon">
                      <WifiOff size={27} />
                    </span>
                    <h3>暫時無法讀取主機</h3>
                    <p>{connectionError}</p>
                    <div>
                      <button className="button primary" onClick={() => void loadDirectory(path)}>
                        <RefreshCw size={16} />
                        重新連線
                      </button>
                      <button className="button secondary" onClick={() => setPanel('logs')}>
                        <Terminal size={16} />
                        查看紀錄
                      </button>
                      {activeProfile && (
                        <button
                          className="text-button"
                          onClick={() => setConnectionDialog(activeProfile)}
                        >
                          編輯連線
                        </button>
                      )}
                    </div>
                  </div>
                ) : loading ? (
                  <div className="file-skeleton" aria-label="正在讀取資料夾" role="status">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <div key={i}>
                        <span />
                        <span />
                        <span />
                        <span />
                      </div>
                    ))}
                  </div>
                ) : !sorted.length ? (
                  <div className="empty-state">
                    <span className="empty-folder">
                      <FolderOpen size={44} strokeWidth={1.4} />
                    </span>
                    <h3>{query ? '沒有找到符合的檔案' : '這個資料夾，等你放入靈感'}</h3>
                    <p>
                      {query
                        ? '試試其他名稱，或清除搜尋條件。'
                        : demo
                          ? '這是範例資料夾。新增連線後，即可上傳自己的檔案。'
                          : '把檔案拖放到這裡，或點選下方按鈕上傳。'}
                    </p>
                    {query ? (
                      <button className="button secondary" onClick={() => setQuery('')}>
                        清除搜尋
                      </button>
                    ) : (
                      <button
                        className="button secondary"
                        onClick={() => (canManage ? uploadInput.current?.click() : addConnection())}
                      >
                        <Plus size={16} />
                        {canManage ? '上傳第一個檔案' : '新增連線'}
                      </button>
                    )}
                  </div>
                ) : view === 'list' ? (
                  <div className="file-table-wrap">
                    <table className="file-table">
                      <thead>
                        <tr>
                          <th className="checkbox-cell">
                            <input
                              type="checkbox"
                              aria-label="選取所有顯示項目"
                              checked={
                                sorted.length > 0 &&
                                sorted.every((entry) => selected.has(entry.path))
                              }
                              onChange={(event) =>
                                setSelected(
                                  event.target.checked
                                    ? new Set(sorted.map((entry) => entry.path))
                                    : new Set(),
                                )
                              }
                            />
                          </th>
                          {(['name', 'modified', 'type', 'size'] as const).map((key) => (
                            <th key={key} className={`column-${key}`}>
                              <button onClick={() => handleSort(key)}>
                                {sortLabel[key]}
                                {sort === key ? (
                                  <ArrowDown size={13} className={ascending ? 'rotate-180' : ''} />
                                ) : (
                                  <ArrowUpDown size={12} />
                                )}
                              </button>
                            </th>
                          ))}
                          <th className="actions-cell">
                            <span className="sr-only">操作</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {sorted.map((entry) => (
                          <tr
                            key={entry.path}
                            className={selected.has(entry.path) ? 'row-selected' : ''}
                            onClick={(event) => select(entry, event.ctrlKey || event.metaKey)}
                            onDoubleClick={() => openEntry(entry)}
                          >
                            <td
                              className="checkbox-cell"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <input
                                type="checkbox"
                                checked={selected.has(entry.path)}
                                aria-label={`選取 ${entry.name}`}
                                onChange={() => select(entry, true)}
                              />
                            </td>
                            <td className="column-name">
                              <button
                                className="file-name"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openEntry(entry);
                                }}
                              >
                                <FileIcon entry={entry} />
                                <span>{entry.name}</span>
                                {entry.directory && (
                                  <ChevronRight className="file-name-chevron" size={14} />
                                )}
                              </button>
                            </td>
                            <td className="column-modified">{formatDate(entry.modified)}</td>
                            <td className="column-type">{entryType(entry)}</td>
                            <td className="column-size">{formatBytes(entry.size)}</td>
                            <td className="actions-cell">
                              <button
                                className="icon-button"
                                aria-label={`${entry.name} 的操作`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  const rect = event.currentTarget.getBoundingClientRect();
                                  setRowMenu({
                                    entry,
                                    x: Math.max(12, Math.min(innerWidth - 220, rect.right - 206)),
                                    y: Math.max(12, Math.min(rect.bottom + 4, innerHeight - 300)),
                                  });
                                }}
                              >
                                <MoreHorizontal size={19} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <>
                    <div className="grid-sort">
                      <span>{sorted.length} 個項目</span>
                      <label>
                        排序：
                        <select
                          aria-label="網格排序欄位"
                          value={sort}
                          onChange={(event) => setSort(event.target.value as typeof sort)}
                        >
                          {Object.entries(sortLabel).map(([key, name]) => (
                            <option key={key} value={key}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        className="icon-button"
                        aria-label="切換排序方向"
                        onClick={() => setAscending(!ascending)}
                      >
                        <ArrowDown size={15} className={ascending ? 'rotate-180' : ''} />
                      </button>
                    </div>
                    <div className="file-grid">
                      {sorted.map((entry) => (
                        <article
                          className={`file-card ${selected.has(entry.path) ? 'file-card-selected' : ''}`}
                          key={entry.path}
                        >
                          <div className="file-card-top">
                            <input
                              type="checkbox"
                              aria-label={`選取 ${entry.name}`}
                              checked={selected.has(entry.path)}
                              onChange={() => select(entry, true)}
                            />
                            <button
                              className="icon-button"
                              aria-label={`${entry.name} 的操作`}
                              onClick={(event) => {
                                const rect = event.currentTarget.getBoundingClientRect();
                                setRowMenu({
                                  entry,
                                  x: Math.max(12, Math.min(innerWidth - 220, rect.right - 206)),
                                  y: Math.max(12, Math.min(rect.bottom + 4, innerHeight - 300)),
                                });
                              }}
                            >
                              <MoreHorizontal size={18} />
                            </button>
                          </div>
                          <button className="file-card-main" onClick={() => openEntry(entry)}>
                            <FileIcon entry={entry} large />
                            <strong>{entry.name}</strong>
                            <span>
                              {entry.directory ? '資料夾' : formatBytes(entry.size)}
                              <span>·</span>
                              {formatDate(entry.modified)}
                            </span>
                          </button>
                        </article>
                      ))}
                    </div>
                  </>
                )}
                <div className="file-section-footer">
                  <span>
                    {query ? `${sorted.length} 個搜尋結果` : `${entries.length} 個項目`}
                    <span className="footer-dot">·</span>
                    {folders.length} 個資料夾<span className="footer-dot">·</span>
                    {entries.length - folders.length} 個檔案
                  </span>
                  <span>
                    {demo ? (
                      '唯讀互動範例'
                    ) : (
                      <>
                        <ShieldCheck size={13} />
                        直接連線至你的主機
                      </>
                    )}
                  </span>
                </div>
              </section>
              <div className="workspace-footnote">
                <Upload size={13} />
                {demo
                  ? '準備好連上自己的雲端了嗎？'
                  : '小提示：將檔案拖放到這個頁面，即可上傳到目前資料夾。'}
                {demo && (
                  <button className="text-button" onClick={addConnection}>
                    新增連線
                    <ArrowRight size={13} />
                  </button>
                )}
              </div>
            </>
          )}
          {dragging && (
            <div className="drop-overlay">
              <span>
                <CloudUpload size={52} />
                <h2>{canManage ? '放開，即可上傳' : '先連接你的 WebDAV 主機'}</h2>
                <p>{canManage ? '檔案會上傳到目前資料夾' : '新增連線後，就能將檔案拖放到這裡'}</p>
              </span>
            </div>
          )}
        </main>
        <ActivityPanels
          logs={logs}
          tasks={tasks}
          open={panel}
          onToggle={(tab) => setPanel(panel === tab ? null : tab)}
          onClearLogs={() => setLogs([])}
          onCancel={(id) => queue.current!.cancel(id)}
          onRetry={(id) => queue.current!.retry(id)}
          onClearTasks={() => queue.current!.clearFinished()}
          notify={notify}
        />
      </div>
      <input
        className="sr-only"
        ref={uploadInput}
        type="file"
        multiple
        aria-label="選擇上傳檔案"
        onChange={(event) => {
          void uploadFiles(Array.from(event.target.files ?? []));
          event.target.value = '';
        }}
        tabIndex={-1}
      />
      {toast && (
        <div className="toast" role="status" key={toast.id}>
          <CircleAlert size={18} />
          <span>{toast.message}</span>
          <button aria-label="關閉通知" onClick={() => setToast(undefined)}>
            <X size={16} />
          </button>
        </div>
      )}
      {vaultDialog && (
        <VaultDialog
          key={vaultDialog}
          mode={vaultDialog}
          onSubmit={handleVault}
          onClose={() => {
            setVaultDialog(undefined);
            afterUnlock.current = null;
          }}
          onReset={async () => {
            await writeVault();
            resetConnection();
            session.current = null;
            setProfiles([]);
            setActiveProfile(null);
            setDemo(false);
            setPath('');
            currentPath.current = '';
            setVaultState('empty');
            setLogs([]);
            setVaultDialog('create');
            notify('本機密碼庫已清除，可建立新的主密碼。');
          }}
        />
      )}
      {connectionDialog && (
        <ConnectionDialog
          profile={connectionDialog === 'new' ? undefined : connectionDialog}
          onSave={saveProfile}
          onTest={testProfile}
          onClose={() => setConnectionDialog(undefined)}
        />
      )}
      {removeProfile && (
        <Modal
          title="移除這組連線？"
          subtitle="只會移除本機儲存的連線設定，不會刪除主機檔案。"
          onClose={() => {
            if (!operationBusy) setRemoveProfile(undefined);
          }}
        >
          <p className="confirmation-name">
            <HardDrive size={20} />
            {removeProfile.name}
          </p>
          <InlineError message={operationError} />
          <footer className="modal-footer">
            <button
              className="button secondary"
              disabled={operationBusy}
              onClick={() => setRemoveProfile(undefined)}
            >
              取消
            </button>
            <button
              className="button danger"
              disabled={operationBusy}
              onClick={async () => {
                setOperationBusy(true);
                setOperationError('');
                try {
                  await saveProfiles(profiles.filter((profile) => profile.id !== removeProfile.id));
                  if (activeProfile?.id === removeProfile.id) {
                    resetConnection();
                    setActiveProfile(null);
                    setPath('');
                  }
                  setRemoveProfile(undefined);
                  notify('連線已移除。');
                } catch (error) {
                  setOperationError((error as Error).message);
                } finally {
                  setOperationBusy(false);
                }
              }}
            >
              移除連線
            </button>
          </footer>
        </Modal>
      )}
      {preview && (
        <PreviewDialog
          entry={preview}
          client={client.current}
          demo={demo}
          onClose={() => setPreview(undefined)}
          onDownload={() => void download(preview)}
        />
      )}
      {operation && ['move', 'copy'].includes(operation.kind) && client.current && (
        <DestinationDialog
          client={client.current}
          operation={operation.kind as 'move' | 'copy'}
          onClose={() => setOperation(undefined)}
          onSubmit={(destination) => submitOperation(undefined, destination)}
        />
      )}
      {operation && !['move', 'copy'].includes(operation.kind) && (
        <Modal
          title={
            {
              mkdir: '新增資料夾',
              rename: '重新命名',
              delete: `永久刪除 ${operation.items.length} 個項目？`,
              move: '',
              copy: '',
            }[operation.kind]
          }
          subtitle={
            operation.kind === 'delete'
              ? '此操作無法復原，資料夾中的所有內容也會一併刪除。'
              : '使用清楚的名稱，讓你的工作空間更有條理。'
          }
          onClose={() => {
            if (!operationBusy) setOperation(undefined);
          }}
        >
          <form
            className="form-stack"
            onSubmit={(event) => {
              void submitOperation(event).catch(() => {});
            }}
          >
            {operation.kind === 'delete' ? (
              <div className="delete-list">
                {operation.items.map((entry) => (
                  <div key={entry.path}>
                    <FileIcon entry={entry} />
                    <span>{entry.name}</span>
                  </div>
                ))}
              </div>
            ) : (
              <label>
                {operation.kind === 'mkdir' ? '資料夾名稱' : '新名稱'}
                <input
                  value={operationValue}
                  onChange={(event) => setOperationValue(event.target.value)}
                  required
                  disabled={operationBusy}
                />
              </label>
            )}
            <InlineError message={operationError} />
            <footer className="modal-footer">
              <button
                type="button"
                className="button secondary"
                disabled={operationBusy}
                onClick={() => setOperation(undefined)}
              >
                取消
              </button>
              <button
                className={`button ${operation.kind === 'delete' ? 'danger' : 'primary'}`}
                disabled={operationBusy}
                type="submit"
              >
                {operationBusy && <LoaderCircle className="spin" size={16} />}
                {operation.kind === 'delete' ? '確認永久刪除' : '確認'}
              </button>
            </footer>
          </form>
        </Modal>
      )}
      {conflict && (
        <Modal
          title="同名檔案已存在"
          subtitle="選擇跳過這個檔案，或以新的內容覆寫主機上的檔案。"
          onClose={() => {
            conflict.resolve('cancel');
            setConflict(undefined);
          }}
        >
          <p className="confirmation-name">
            <File size={20} />
            {conflict.name}
          </p>
          <footer className="modal-footer">
            <button className="button secondary" onClick={() => conflict.resolve('skip')}>
              跳過檔案
            </button>
            <button className="button danger" onClick={() => conflict.resolve('overwrite')}>
              確認覆寫
            </button>
          </footer>
        </Modal>
      )}
      {rowMenu && (
        <>
          <div className="menu-scrim" onClick={() => setRowMenu(undefined)} />
          <div
            ref={menuRef}
            className="context-menu"
            role="menu"
            style={{ left: rowMenu.x, top: rowMenu.y }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setRowMenu(undefined);
            }}
          >
            <button role="menuitem" onClick={() => openEntry(rowMenu.entry)}>
              {rowMenu.entry.directory ? <FolderOpen size={16} /> : <FileText size={16} />}
              {rowMenu.entry.directory ? '開啟資料夾' : '預覽／檔案資訊'}
            </button>
            {!rowMenu.entry.directory && (
              <button role="menuitem" onClick={() => void download(rowMenu.entry)}>
                <ArrowDownToLine size={16} />
                下載檔案
              </button>
            )}
            <hr />
            <button role="menuitem" onClick={() => beginOperation('rename', [rowMenu.entry])}>
              <Pencil size={16} />
              重新命名
            </button>
            <button role="menuitem" onClick={() => beginOperation('move', [rowMenu.entry])}>
              <MoveRight size={16} />
              移動至
            </button>
            <button role="menuitem" onClick={() => beginOperation('copy', [rowMenu.entry])}>
              <Copy size={16} />
              複製至
            </button>
            <hr />
            <button
              role="menuitem"
              className="danger-text"
              onClick={() => beginOperation('delete', [rowMenu.entry])}
            >
              <Trash2 size={16} />
              永久刪除
            </button>
          </div>
        </>
      )}
      {settings && (
        <Modal
          title="工作空間設定"
          subtitle="調整你的使用體驗與本機密碼庫。"
          onClose={() => setSettings(false)}
        >
          <div className="settings-list">
            <div>
              <span>
                <Sun size={19} />
                <strong>外觀</strong>
              </span>
              <button className="button secondary" onClick={switchTheme}>
                {theme === 'dark' ? '深色' : '淺色'}
                <ChevronDown size={15} />
              </button>
            </div>
            <div>
              <span>
                <LockKeyhole size={19} />
                <strong>本機密碼庫</strong>
              </span>
              <span className="muted">
                {vaultState === 'unlocked'
                  ? '已解鎖'
                  : vaultState === 'empty'
                    ? '尚未建立'
                    : '已鎖定'}
              </span>
            </div>
            {vaultState === 'unlocked' ? (
              <>
                <div>
                  <span>
                    <KeyRound size={19} />
                    <strong>變更主密碼</strong>
                  </span>
                  <button
                    className="button secondary"
                    onClick={() => {
                      setSettings(false);
                      setVaultDialog('change');
                    }}
                  >
                    變更
                  </button>
                </div>
                <div>
                  <span>
                    <ShieldCheck size={19} />
                    <strong>鎖定並中止傳輸</strong>
                  </span>
                  <button className="button secondary" onClick={lockVault}>
                    立即鎖定
                  </button>
                </div>
              </>
            ) : (
              <button
                className="button primary full"
                onClick={() => {
                  setSettings(false);
                  ensureUnlocked(() => {});
                }}
              >
                開啟密碼庫
              </button>
            )}
          </div>
          <p className="muted small settings-note">
            只有外觀與檢視偏好以一般設定保存。連線網址、帳號與密碼均存放在加密密碼庫中。
          </p>
        </Modal>
      )}
      {help && (
        <Modal
          title="開始使用 WebDAV Studio"
          subtitle="你的檔案直接在瀏覽器與 WebDAV 主機之間傳輸。"
          wide
          onClose={() => setHelp(false)}
        >
          <div className="help-content">
            <div className="help-heading">
              <Link2 size={20} />
              <h3>連線前，確認這 3 件事</h3>
            </div>
            <ol>
              <li>
                <strong>啟用 WebDAV 服務</strong>
                <p>填寫完整的 WebDAV 根目錄網址，並使用有讀寫權限的帳號。</p>
              </li>
              <li>
                <strong>使用有效的 HTTPS 憑證</strong>
                <p>從 GitHub Pages 開啟時，主機也必須使用 HTTPS。瀏覽器無法繞過無效憑證。</p>
              </li>
              <li>
                <strong>允許跨來源請求（CORS）</strong>
                <p>
                  在 WebDAV 主機或反向代理允許下列網站來源，以及 WebDAV
                  方法、Authorization、Depth、Destination、Overwrite、If-None-Match 等標頭。OPTIONS
                  預檢不應要求登入。
                </p>
                <code>{location.origin}</code>
              </li>
            </ol>
            <div className="help-heading">
              <Terminal size={20} />
              <h3>連線有問題？</h3>
            </div>
            <p>
              展開底部「除錯紀錄」查看請求與回應；若沒有狀態碼，請開啟瀏覽器開發者工具的
              Console／Network，確認網路、CORS、憑證或重新導向設定。主機的錯誤回應也需要 CORS
              標頭，瀏覽器才能讀取。
            </p>
            <div className="security-note">
              <ShieldCheck size={20} />
              <span>
                記錄不含密碼與授權資訊；僅在本次頁面保留，可匯出
                JSON。主密碼遺失無法復原本機密碼庫。
              </span>
            </div>
            <p className="muted small">
              第一版提供單檔下載；不含資料夾上傳、ZIP 打包、斷點續傳與回收筒。非串流下載上限為 256
              MiB；圖片預覽 20 MiB、文字預覽 1 MiB。
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
