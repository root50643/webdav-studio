import type { ConnectionProfile } from '../types';

export interface VaultEnvelope {
  version: 1;
  iterations: number;
  salt: number[];
  iv: number[];
  ciphertext: number[];
}
export interface VaultSession {
  key: CryptoKey;
  salt: number[];
  iterations: number;
}
const ITERATIONS = 600_000;
// GitHub project Pages share an origin; separate vaults by this app's deployment path.
const DB_NAME = `webdav-studio:${new URL(import.meta.env.BASE_URL, location.href).pathname}`;
const STORE = 'vault';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('無法開啟本機密碼庫。請檢查瀏覽器的儲存權限。'));
    request.onblocked = () => reject(new Error('密碼庫被另一個分頁占用，請關閉其他分頁後重試。'));
  });
}

export async function readVault(): Promise<VaultEnvelope | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get('current');
    tx.oncomplete = () => {
      db.close();
      resolve(request.result);
    };
    tx.onerror = () => {
      db.close();
      reject(new Error('無法讀取密碼庫。'));
    };
    tx.onabort = () => {
      db.close();
      reject(new Error('讀取密碼庫已中止。'));
    };
  });
}

export async function writeVault(envelope?: VaultEnvelope): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    try {
      if (envelope) tx.objectStore(STORE).put(envelope, 'current');
      else tx.objectStore(STORE).delete('current');
    } catch {
      tx.abort();
      db.close();
      reject(new Error('密碼庫儲存失敗，變更尚未保存。請檢查磁碟空間與瀏覽器權限。'));
      return;
    }
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(new Error('密碼庫儲存失敗，變更尚未保存。請檢查磁碟空間與瀏覽器權限。'));
    };
  });
}

export async function createSession(
  password: string,
  salt = Array.from(crypto.getRandomValues(new Uint8Array(16))),
  iterations = ITERATIONS,
): Promise<VaultSession> {
  if (!crypto.subtle) throw new Error('加密功能需要安全環境，請使用 HTTPS 或 localhost 開啟。');
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: new Uint8Array(salt), iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  return { key, salt, iterations };
}

export async function encryptProfiles(
  profiles: ConnectionProfile[],
  session: VaultSession,
): Promise<VaultEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('webdav-studio:v1') },
    session.key,
    new TextEncoder().encode(JSON.stringify(profiles)),
  );
  return {
    version: 1,
    iterations: session.iterations,
    salt: session.salt,
    iv: Array.from(iv),
    ciphertext: Array.from(new Uint8Array(ciphertext)),
  };
}

export async function decryptProfiles(
  envelope: VaultEnvelope,
  password: string,
): Promise<{ profiles: ConnectionProfile[]; session: VaultSession }> {
  if (
    envelope.version !== 1 ||
    !Number.isInteger(envelope.iterations) ||
    envelope.iterations < 100_000 ||
    envelope.iterations > 2_000_000 ||
    !Array.isArray(envelope.salt) ||
    envelope.salt.length !== 16 ||
    !Array.isArray(envelope.iv) ||
    envelope.iv.length !== 12 ||
    !Array.isArray(envelope.ciphertext)
  ) {
    throw new Error('密碼庫格式不支援或資料已損壞。');
  }
  const session = await createSession(password, envelope.salt, envelope.iterations);
  try {
    const clear = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: new Uint8Array(envelope.iv),
        additionalData: new TextEncoder().encode('webdav-studio:v1'),
      },
      session.key,
      new Uint8Array(envelope.ciphertext),
    );
    const profiles: unknown = JSON.parse(new TextDecoder().decode(clear));
    if (
      !Array.isArray(profiles) ||
      !profiles.every(
        (p) =>
          p &&
          typeof p.id === 'string' &&
          typeof p.name === 'string' &&
          typeof p.baseUrl === 'string' &&
          typeof p.username === 'string' &&
          typeof p.password === 'string' &&
          ['basic', 'anonymous'].includes(p.auth) &&
          Number.isFinite(p.timeoutMs) &&
          p.timeoutMs >= 1000,
      )
    )
      throw new Error();
    return { profiles, session };
  } catch {
    throw new Error('主密碼不正確，或密碼庫資料已損壞。原有資料尚未變更。');
  }
}
