import { webcrypto } from 'node:crypto';
import { Blob, File } from 'node:buffer';
import { TextEncoder, TextDecoder } from 'node:util';
import { vi } from 'vitest';
import 'fake-indexeddb/auto';

export const BrowserFile = globalThis.File;
vi.stubGlobal('crypto', webcrypto);
vi.stubGlobal('Blob', Blob);
vi.stubGlobal('File', File);
vi.stubGlobal('TextEncoder', TextEncoder);
vi.stubGlobal('TextDecoder', TextDecoder);
