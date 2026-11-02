import { useState, type FormEvent } from 'react';
import { KeyRound, LoaderCircle, LockKeyhole, ShieldCheck } from 'lucide-react';
import { InlineError, Modal } from './Modal';

export type VaultMode = 'create' | 'unlock' | 'change';
export function VaultDialog({
  mode,
  onSubmit,
  onReset,
  onClose,
}: {
  mode: VaultMode;
  onSubmit: (password: string, newPassword?: string) => Promise<void>;
  onReset: () => Promise<void>;
  onClose: () => void;
}) {
  const [password, setPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [reset, setReset] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    const target = mode === 'change' ? nextPassword : password;
    if (mode !== 'unlock' && (target.length < 8 || target !== confirmation)) {
      setError('主密碼至少需要 8 個字元，且兩次輸入必須相同。');
      return;
    }
    setBusy(true);
    try {
      await onSubmit(password, mode === 'change' ? nextPassword : undefined);
    } catch (error) {
      setError(error instanceof Error ? error.message : '密碼庫操作失敗。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        mode === 'create'
          ? '為你的連線，加一道鎖'
          : mode === 'change'
            ? '變更主密碼'
            : '歡迎回來，解鎖工作空間'
      }
      subtitle={
        mode === 'create'
          ? '建立主密碼，加密保存你的主機、帳號與密碼。'
          : '主密碼僅用於本機解密，不會傳送到任何主機。'
      }
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="vault-illustration">
        <LockKeyhole size={32} />
        <span>
          <ShieldCheck size={16} />
          AES-256-GCM
        </span>
      </div>
      <form className="form-stack" onSubmit={submit}>
        <label>
          {mode === 'change' ? '目前的主密碼' : '主密碼'}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
            minLength={mode === 'create' ? 8 : undefined}
            required
            disabled={busy}
            placeholder={mode === 'create' ? '至少 8 個字元' : '輸入主密碼'}
          />
        </label>
        {mode === 'change' && (
          <label>
            新的主密碼
            <input
              type="password"
              value={nextPassword}
              onChange={(e) => setNextPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
              disabled={busy}
            />
          </label>
        )}
        {mode !== 'unlock' && (
          <label>
            再次輸入{mode === 'change' ? '新的' : ''}主密碼
            <input
              type="password"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
              disabled={busy}
            />
          </label>
        )}
        <p className="muted small">
          請妥善保管主密碼。忘記後無法復原已儲存的連線，只能清除本機密碼庫後重新建立。
        </p>
        <InlineError message={error} />
        <button className="button primary full" type="submit" disabled={busy}>
          {busy ? <LoaderCircle className="spin" size={18} /> : <KeyRound size={18} />}
          {mode === 'create' ? '建立加密密碼庫' : mode === 'change' ? '更新主密碼' : '解鎖密碼庫'}
        </button>
      </form>
      {mode === 'unlock' && (
        <div className="vault-reset">
          {!reset ? (
            <button className="text-button" onClick={() => setReset(true)}>
              忘記主密碼？
            </button>
          ) : (
            <>
              <p>清除將永久移除此瀏覽器儲存的所有連線設定，不會刪除主機檔案。</p>
              <button
                className="button danger"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onReset();
                  } catch (error) {
                    setError(error instanceof Error ? error.message : '清除失敗');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                確認清除本機密碼庫
              </button>
              <button className="text-button" disabled={busy} onClick={() => setReset(false)}>
                保留資料
              </button>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
