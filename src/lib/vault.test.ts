import { describe, expect, it, vi } from 'vitest';
import { createSession, decryptProfiles, encryptProfiles, readVault, writeVault } from './vault';
import type { ConnectionProfile } from '../types';

const profiles: ConnectionProfile[] = [
  {
    id: 'test',
    name: '私人主機',
    baseUrl: 'https://private.example/dav/',
    auth: 'basic',
    username: 'user',
    password: 'very-secret-password',
    timeoutMs: 120_000,
  },
];
describe('encrypted connection vault', () => {
  it('round-trips all profile data without plaintext credentials or an extractable key', async () => {
    const session = await createSession('master-password-123');
    const envelope = await encryptProfiles(profiles, session);
    expect(JSON.stringify(envelope)).not.toContain('very-secret-password');
    expect(JSON.stringify(envelope)).not.toContain('private.example');
    expect(session.key.extractable).toBe(false);
    expect((await decryptProfiles(envelope, 'master-password-123')).profiles).toEqual(profiles);
  });
  it('generates a fresh IV for every write and rejects a wrong password and tampering', async () => {
    const session = await createSession('master-password-123');
    const first = await encryptProfiles(profiles, session),
      second = await encryptProfiles(profiles, session);
    expect(first.iv).not.toEqual(second.iv);
    expect(first.ciphertext).not.toEqual(second.ciphertext);
    await expect(decryptProfiles(first, 'wrong-password')).rejects.toThrow('主密碼不正確');
    const corrupt = structuredClone(first);
    corrupt.ciphertext[0] ^= 1;
    await expect(decryptProfiles(corrupt, 'master-password-123')).rejects.toThrow('資料已損壞');
    await expect(
      decryptProfiles({ ...first, iterations: 99_999_999 }, 'master-password-123'),
    ).rejects.toThrow('格式');
  });
  it('re-encrypts under a new master password', async () => {
    const next = await encryptProfiles(profiles, await createSession('new-master-password'));
    expect((await decryptProfiles(next, 'new-master-password')).profiles).toEqual(profiles);
    await expect(decryptProfiles(next, 'master-password-123')).rejects.toThrow();
  });
  it('persists only encrypted data and keeps the previous vault after a failed write', async () => {
    const original = await encryptProfiles(profiles, await createSession('master-password-123'));
    await writeVault(original);
    expect(await readVault()).toEqual(original);
    expect(JSON.stringify(await readVault())).not.toContain(profiles[0].password);
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });
    await expect(writeVault({ ...original, ciphertext: [1, 2, 3] })).rejects.toThrow('尚未保存');
    expect(await readVault()).toEqual(original);
    await writeVault();
    expect(await readVault()).toBeUndefined();
  });
});
