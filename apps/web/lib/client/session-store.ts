/**
 * Session keys live in IndexedDB as non-extractable WebCrypto keys. Page script can ask the browser
 * to sign with them, but nothing can read the private key out, including this app's own code.
 */
const DB_NAME = 'uproar';
const STORE = 'sessions';

export type StoredSession = { profile: string; delegate: string; keyPair: CryptoKeyPair; expiresAt: number };

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'profile' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = run(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function loadSession(profile: string): Promise<StoredSession | null> {
  const found = await withStore<StoredSession | undefined>('readonly', (s) => s.get(profile));
  return found ?? null;
}

export async function saveSession(session: StoredSession): Promise<void> {
  await withStore('readwrite', (s) => s.put(session));
}

export async function clearSession(profile: string): Promise<void> {
  await withStore('readwrite', (s) => s.delete(profile));
}

let support: Promise<boolean> | null = null;

/** Older browsers and some in-app browsers lack Ed25519 in WebCrypto. They fall back to the wallet. */
export function supportsSessionKeys(): Promise<boolean> {
  support ??= (async () => {
    try {
      if (!window.isSecureContext || !window.indexedDB) return false;
      await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
      return true;
    } catch {
      return false;
    }
  })();
  return support;
}
