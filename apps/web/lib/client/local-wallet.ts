'use client';
/**
 * A wallet for trying the app on your own machine, against the local validator. Real wallets can't
 * reach a local chain, so this stands in for one. It exists only in `next dev` on localnet: the
 * check below is compiled away in production builds, so it can never ship to devnet or mainnet.
 */
import { getBase58Decoder } from '@solana/kit';

const STORE = 'uproar.localwallet';
const NAME = 'Local test wallet';
const CHAINS = ['solana:localnet'] as const;
const FEATURES = ['solana:signAndSendTransaction', 'solana:signTransaction', 'solana:signMessage'];
const FUND_LAMPORTS = 5_000_000_000;

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function keys(): Promise<{ privateKey: CryptoKey; publicKey: Uint8Array; address: string }> {
  let saved = localStorage.getItem(STORE);
  if (!saved) {
    const pair = (await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])) as CryptoKeyPair;
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    saved = JSON.stringify({ pkcs8: b64(pkcs8), publicKey: b64(raw) });
    localStorage.setItem(STORE, saved);
  }
  const { pkcs8, publicKey } = JSON.parse(saved) as { pkcs8: string; publicKey: string };
  const privateKey = await crypto.subtle.importKey('pkcs8', unb64(pkcs8), 'Ed25519', false, ['sign']);
  const pub = unb64(publicKey);
  return { privateKey, publicKey: pub, address: getBase58Decoder().decode(pub) };
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch('/api/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const body = (await res.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(body.error.message);
  return body.result as T;
}

function shortvec(bytes: Uint8Array, offset: number): { value: number; size: number } {
  let value = 0;
  let shift = 0;
  let size = 0;
  for (;;) {
    const b = bytes[offset + size] as number;
    value |= (b & 0x7f) << shift;
    size += 1;
    if ((b & 0x80) === 0) return { value, size };
    shift += 7;
  }
}

/** Signs a wire transaction in place, at this wallet's signer slot. */
async function signWire(transaction: Uint8Array, privateKey: CryptoKey, publicKey: Uint8Array): Promise<{ signed: Uint8Array; signature: Uint8Array }> {
  const out = new Uint8Array(transaction);
  const { value: count, size } = shortvec(out, 0);
  const message = out.subarray(size + count * 64);
  const keysAt = ((message[0] as number) & 0x80 ? 1 : 0) + 3;
  const { value: keyCount, size: keySize } = shortvec(message, keysAt);
  let index = -1;
  for (let i = 0; i < keyCount; i++) {
    const k = message.subarray(keysAt + keySize + i * 32, keysAt + keySize + (i + 1) * 32);
    if (k.every((b, j) => b === publicKey[j])) {
      index = i;
      break;
    }
  }
  if (index < 0 || index >= count) throw new Error('This wallet is not a signer of this transaction');
  const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', privateKey, message));
  out.set(signature, size + index * 64);
  return { signed: out, signature };
}

/** Tops the wallet up with free local SOL, so trying things never stops for a faucet. */
async function fund(address: string): Promise<void> {
  const { value } = await rpc<{ value: number }>('getBalance', [address, { commitment: 'confirmed' }]);
  if (value >= 1_000_000_000) return;
  const sig = await rpc<string>('requestAirdrop', [address, FUND_LAMPORTS]);
  for (let i = 0; i < 40; i++) {
    const { value: statuses } = await rpc<{ value: ({ confirmationStatus?: string } | null)[] }>('getSignatureStatuses', [[sig]]);
    if (statuses[0]?.confirmationStatus === 'confirmed' || statuses[0]?.confirmationStatus === 'finalized') return;
    await new Promise((r) => setTimeout(r, 400));
  }
}

/** Like a real wallet, keep resending until the chain confirms. The same bytes can only ever land once. */
function keepSending(wire: string, signature: string): void {
  let tries = 0;
  const timer = setInterval(async () => {
    tries += 1;
    try {
      const { value } = await rpc<{ value: ({ confirmationStatus?: string; err?: unknown } | null)[] }>('getSignatureStatuses', [[signature]]);
      const status = value[0];
      const settled = Boolean(status && (status.err || status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized'));
      if (settled || tries > 20) {
        clearInterval(timer);
        return;
      }
      await rpc('sendTransaction', [wire, { encoding: 'base64', skipPreflight: true }]);
    } catch {
      // Try again on the next tick, up to the cap.
    }
  }, 2_000);
}

let registered = false;

export async function registerLocalWallet(): Promise<void> {
  if (process.env.NODE_ENV !== 'development' || process.env.NEXT_PUBLIC_CLUSTER !== 'localnet') return;
  if (registered || typeof window === 'undefined' || !window.isSecureContext) return;
  registered = true;
  const { privateKey, publicKey, address } = await keys();
  const account = { address, publicKey, chains: CHAINS, features: FEATURES, label: NAME };
  const listeners = new Set<(e: { accounts: unknown[] }) => void>();
  let accounts: (typeof account)[] = [];
  const emit = () => listeners.forEach((l) => l({ accounts }));

  const wallet = {
    version: '1.0.0' as const,
    name: NAME,
    icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiBmaWxsPSIjZmYyZDk1Ii8+PHBhdGggZD0iTTggOGg0djEyaDh2NEg4eiIgZmlsbD0iIzA1MDcwYyIvPjwvc3ZnPg==' as const,
    chains: CHAINS,
    get accounts() {
      return accounts;
    },
    features: {
      'standard:connect': {
        version: '1.0.0',
        connect: async ({ silent }: { silent?: boolean } = {}) => {
          if (silent && localStorage.getItem(`${STORE}.connected`) !== '1') return { accounts };
          // Wait for the top-up on a real connect, so the first claim can pay. On page loads, top up quietly.
          const funding = fund(address).catch((e: unknown) => console.warn('The local test wallet could not get test SOL', e));
          if (!silent) await funding;
          localStorage.setItem(`${STORE}.connected`, '1');
          accounts = [account];
          emit();
          return { accounts };
        },
      },
      'standard:disconnect': {
        version: '1.0.0',
        disconnect: async () => {
          localStorage.removeItem(`${STORE}.connected`);
          accounts = [];
          emit();
        },
      },
      'standard:events': {
        version: '1.0.0',
        on: (event: string, listener: (e: { accounts: unknown[] }) => void) => {
          if (event !== 'change') return () => {};
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      'solana:signAndSendTransaction': {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy', 0],
        signAndSendTransaction: async (...inputs: { transaction: Uint8Array }[]) => {
          const results = [];
          for (const input of inputs) {
            const { signed, signature } = await signWire(input.transaction, privateKey, publicKey);
            const wire = b64(signed);
            await rpc('sendTransaction', [wire, { encoding: 'base64', preflightCommitment: 'confirmed' }]);
            keepSending(wire, getBase58Decoder().decode(signature));
            results.push({ signature });
          }
          return results;
        },
      },
      'solana:signTransaction': {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy', 0],
        signTransaction: async (...inputs: { transaction: Uint8Array }[]) =>
          Promise.all(inputs.map(async (input) => ({ signedTransaction: (await signWire(input.transaction, privateKey, publicKey)).signed }))),
      },
      'solana:signMessage': {
        version: '1.0.0',
        signMessage: async (...inputs: { message: Uint8Array }[]) =>
          Promise.all(inputs.map(async (input) => ({ signedMessage: input.message, signature: new Uint8Array(await crypto.subtle.sign('Ed25519', privateKey, new Uint8Array(input.message))) }))),
      },
    },
  };

  const register = ({ register: r }: { register: (w: unknown) => void }) => r(wallet);
  window.addEventListener('wallet-standard:app-ready', ((e: CustomEvent) => register(e.detail)) as EventListener);
  window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: register }));
}
