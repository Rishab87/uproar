'use client';
import { address as toAddress, createSignerFromKeyPair, getBase58Decoder, signBytes, type KeyPairSigner, type TransactionModifyingSigner } from '@solana/kit';
import { useWalletAccountTransactionSigner } from '@solana/react';
import { sessionAddress } from '@uproar/protocol';
import { useConnect, useDisconnect, useWallets, type UiWallet, type UiWalletAccount } from '@wallet-standard/react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import type { ProfileView } from '@/lib/server/queries';
import { AUTH_HEADER, authMessage, sha256Hex } from '@/lib/shared/auth';
import { CHAIN } from './config';
import { clientRpc } from './rpc';
import { clearSession, loadSession, saveSession, supportsSessionKeys, type StoredSession } from './session-store';

const WALLET_KEY = 'uproar.wallet';
const base58 = getBase58Decoder();

export type Session = { signer: KeyPairSigner; address: string; expiresAt: number };

export type Viewer = {
  ready: boolean;
  /** The profile lookup has answered and this browser's session key has been restored or ruled out. */
  settled: boolean;
  wallets: readonly UiWallet[];
  wallet: UiWallet | null;
  account: UiWalletAccount | null;
  profile: ProfileView | null;
  /** The address of a profile that's on chain but not indexed yet, or that has no handle. */
  pendingProfile: { address: string; handle: string | null } | null;
  session: Session | null;
  sessionKeysSupported: boolean;
  /** Signs only. The app sends to its own cluster, so a wallet set to another network still works. */
  walletSigner: TransactionModifyingSigner | null;
  connectOpen: boolean;
  openConnect: () => void;
  closeConnect: () => void;
  selectWallet: (name: string) => void;
  disconnect: () => void;
  refreshProfile: () => Promise<unknown>;
  adoptSession: (s: StoredSession) => Promise<void>;
  dropSession: () => Promise<void>;
  signedFetch: (path: string, init?: { method?: string; body?: unknown }) => Promise<Response>;
};

const Ctx = createContext<Viewer | null>(null);

export function useViewer(): Viewer {
  const v = useContext(Ctx);
  if (!v) throw new Error('useViewer must be used inside ViewerProvider');
  return v;
}

function AutoConnect({ wallet, onDone }: { wallet: UiWallet; onDone: () => void }) {
  const [, connect] = useConnect(wallet);
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    connect({ silent: true }).catch(() => {}).finally(onDone);
  }, [connect, onDone]);
  return null;
}

function SignerBridge({ account, onSigner }: { account: UiWalletAccount; onSigner: (s: TransactionModifyingSigner) => void }) {
  const signer = useWalletAccountTransactionSigner(account, CHAIN);
  useEffect(() => onSigner(signer), [signer, onSigner]);
  return null;
}

function Disconnector({ wallet, armed, onDone }: { wallet: UiWallet; armed: boolean; onDone: () => void }) {
  const [, disconnect] = useDisconnect(wallet);
  useEffect(() => {
    if (!armed) return;
    disconnect().catch(() => {}).finally(onDone);
  }, [armed, disconnect, onDone]);
  return null;
}

type MeResponse = { profiles: ProfileView[]; pending: { address: string; handle: string | null } | null };

export function ViewerProvider({ children }: { children: ReactNode }) {
  const all = useWallets();
  const wallets = useMemo(
    () => all.filter((w) => w.chains.includes(CHAIN) && w.features.includes('standard:connect') && w.features.includes('solana:signTransaction')),
    [all],
  );
  const [walletName, setWalletName] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [connectOpen, setConnectOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState<UiWallet | null>(null);
  // Wallet extensions can hand out a new account object on every read, and with it a new signer.
  // Storing each one in state re-rendered forever, and the page stopped responding to clicks. So the
  // latest signer lives in a ref behind one stable signer, and state changes only when the address does.
  const signerRef = useRef<TransactionModifyingSigner | null>(null);
  const [signerAddress, setSignerAddress] = useState<string | null>(null);
  const onSigner = useCallback((s: TransactionModifyingSigner) => {
    signerRef.current = s;
    setSignerAddress(s.address);
  }, []);
  const walletSigner = useMemo<TransactionModifyingSigner | null>(() => {
    if (!signerAddress) return null;
    return {
      address: signerAddress as TransactionModifyingSigner['address'],
      modifyAndSignTransactions: (...args: Parameters<TransactionModifyingSigner['modifyAndSignTransactions']>) => {
        const current = signerRef.current;
        if (!current) return Promise.reject(new Error('The wallet is not connected'));
        return current.modifyAndSignTransactions(...args);
      },
    };
  }, [signerAddress]);
  const [session, setSession] = useState<Session | null>(null);
  const [sessionKeysSupported, setSupported] = useState(true);
  const [autoTried, setAutoTried] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);
  const { mutate } = useSWRConfig();

  useEffect(() => {
    // A stand-in wallet for the local validator. Production builds drop this branch and the module with it.
    if (process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_CLUSTER === 'localnet') {
      void import('./local-wallet').then((m) => m.registerLocalWallet()).catch(() => {});
    }
    setWalletName(localStorage.getItem(WALLET_KEY));
    setRestoring(false);
    void supportsSessionKeys().then(setSupported);
  }, []);

  const wallet = useMemo(() => wallets.find((w) => w.name === walletName) ?? null, [wallets, walletName]);
  const account = wallet?.accounts[0] ?? null;

  const me = useSWR<MeResponse>(
    account ? `/api/me?wallet=${account.address}` : null,
    async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Profile lookup failed (${res.status})`);
      return (await res.json()) as MeResponse;
    },
    {
      // A fresh claim takes a moment to reach the index, so keep looking until it does.
      refreshInterval: (data) => (data?.pending ? 2_500 : 0),
      revalidateOnFocus: true,
    },
  );
  const profile = me.data?.profiles[0] ?? null;
  const pendingProfile = me.data?.pending ?? null;
  const profileAddress = profile?.address ?? pendingProfile?.address ?? null;

  const adoptSession = useCallback(async (s: StoredSession) => {
    await saveSession(s);
    const signer = await createSignerFromKeyPair(s.keyPair);
    setSession({ signer, address: signer.address, expiresAt: s.expiresAt });
  }, []);

  const dropSession = useCallback(async () => {
    if (profileAddress) await clearSession(profileAddress);
    setSession(null);
  }, [profileAddress]);

  // Restore this browser's session key. The chain has the final word on whether it still exists.
  useEffect(() => {
    let cancelled = false;
    setSession(null);
    setSessionChecked(!profileAddress);
    if (!profileAddress) return;
    void (async () => {
      try {
        await restore();
      } finally {
        if (!cancelled) setSessionChecked(true);
      }
    })();
    async function restore() {
      if (!profileAddress) return;
      const stored = await loadSession(profileAddress).catch(() => null);
      if (!stored || cancelled) return;
      if (stored.expiresAt * 1000 <= Date.now()) return;
      const signer = await createSignerFromKeyPair(stored.keyPair);
      try {
        const address = await sessionAddress(toAddress(profileAddress), signer.address);
        const { value } = await clientRpc().getAccountInfo(address, { encoding: 'base64', dataSlice: { offset: 0, length: 0 } }).send();
        if (!value) {
          await clearSession(profileAddress);
          return;
        }
      } catch {
        // If the network is down the session may still be fine. A failed send will surface it.
      }
      if (!cancelled) setSession({ signer, address: signer.address, expiresAt: stored.expiresAt });
    }
    return () => {
      cancelled = true;
    };
  }, [profileAddress]);

  const selectWallet = useCallback((name: string) => {
    localStorage.setItem(WALLET_KEY, name);
    setWalletName(name);
    setConnectOpen(false);
  }, []);

  const disconnect = useCallback(() => {
    localStorage.removeItem(WALLET_KEY);
    signerRef.current = null;
    setSignerAddress(null);
    setSession(null);
    if (wallet) setDisconnecting(wallet);
    setWalletName(null);
    void mutate(() => true, undefined, { revalidate: true });
  }, [wallet, mutate]);

  const signedFetch = useCallback<Viewer['signedFetch']>(
    async (path, init = {}) => {
      const method = init.method ?? 'GET';
      const body = init.body === undefined ? '' : JSON.stringify(init.body);
      const headers: Record<string, string> = body ? { 'content-type': 'application/json' } : {};
      if (session && profileAddress) {
        const timestamp = Math.floor(Date.now() / 1000);
        const message = authMessage({ host: window.location.host, method, path, profile: profileAddress, timestamp, bodyHash: await sha256Hex(body) });
        const signature = await signBytes(session.signer.keyPair.privateKey, message);
        headers[AUTH_HEADER] = `v1.${profileAddress}.${session.address}.${timestamp}.${base58.decode(signature)}`;
      }
      return fetch(path, { method, headers, ...(body ? { body } : {}) });
    },
    [session, profileAddress],
  );

  const onAutoDone = useCallback(() => setAutoTried(true), []);
  const ready = !restoring && (!walletName || autoTried || Boolean(account));
  const profileLoaded = me.data !== undefined || me.error !== undefined;
  const settled = ready && (!account || (profileLoaded && (sessionChecked || !profileAddress)));
  // For tests and tools that need to know when the viewer is fully known.
  useEffect(() => {
    document.documentElement.dataset.viewer = settled ? 'settled' : 'loading';
  }, [settled]);
  const onDisconnected = useCallback(() => setDisconnecting(null), []);

  const value = useMemo<Viewer>(
    () => ({
      ready,
      settled,
      wallets,
      wallet,
      account,
      profile,
      pendingProfile,
      session,
      sessionKeysSupported,
      walletSigner: account ? walletSigner : null,
      connectOpen,
      openConnect: () => setConnectOpen(true),
      closeConnect: () => setConnectOpen(false),
      selectWallet,
      disconnect,
      refreshProfile: () => me.mutate(),
      adoptSession,
      dropSession,
      signedFetch,
    }),
    [ready, settled, account, wallets, wallet, profile, pendingProfile, session, sessionKeysSupported, walletSigner, connectOpen, selectWallet, disconnect, me, adoptSession, dropSession, signedFetch],
  );

  return (
    <Ctx.Provider value={value}>
      {wallet && !account && !autoTried ? <AutoConnect wallet={wallet} onDone={onAutoDone} /> : null}
      {account ? <SignerBridge key={account.address} account={account} onSigner={onSigner} /> : null}
      {disconnecting ? <Disconnector wallet={disconnecting} armed onDone={onDisconnected} /> : null}
      {children}
    </Ctx.Provider>
  );
}

export function ConnectWalletRow({ wallet, onConnected }: { wallet: UiWallet; onConnected: () => void }) {
  const [isConnecting, connect] = useConnect(wallet);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        className="wallet-row"
        disabled={isConnecting}
        onClick={() => {
          setError(null);
          connect().then(onConnected, () => setError('The wallet did not connect. Open it and try again.'));
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={wallet.icon} alt="" width={32} height={32} />
        <span>{isConnecting ? `Connecting to ${wallet.name}` : wallet.name}</span>
      </button>
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  );
}
