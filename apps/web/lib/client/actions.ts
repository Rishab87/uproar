'use client';
import {
  generateKeyPair,
  createSignerFromKeyPair,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  signTransactionMessageWithSigners,
  address as toAddress,
  type Address,
  type Instruction,
  type Signature,
  type TransactionSigner,
} from '@solana/kit';
import {
  COMPUTE_LIMITS,
  MAX_FUEL_LAMPORTS,
  MAX_TEXT_BYTES,
  MAX_TRANSACTION_BYTES,
  TransactionFailed,
  TransactionTimedOut,
  buildMessage,
  getUproarErrorMessage,
  handleAddress,
  ix,
  profileAddress as deriveProfile,
  sendWireTransaction,
  sessionAddress,
  socialTransactionSize,
  waitForConfirmation,
} from '@uproar/protocol';
import { useMemo } from 'react';
import { IS_MAINNET, LAMPORTS_PER_ACTION, SESSION_DAYS, SESSION_FUEL_ACTIONS } from './config';
import { chainUnixTime, clientRpc, forgetBlockhash, latestBlockhash, priorityFee } from './rpc';
import { saveSession, type StoredSession } from './session-store';
import { addPending, announceLanded, removePending, setOverlay, toast, type PostOverlay } from './stores';
import { refreshAfterAction } from './data';
import { useViewer } from './viewer';


function programErrorMessage(code: number): string | null {
  return code >= 6000 && code < 7000 ? (getUproarErrorMessage(code as never) ?? null) : null;
}

/** A session ends a little before the program's 30-day cap, measured on the chain's clock. */
const SESSION_MARGIN_SECONDS = 15 * 60;
async function sessionExpiry(): Promise<number> {
  return (await chainUnixTime()) + SESSION_DAYS * 86_400 - SESSION_MARGIN_SECONDS;
}

/** Says what went wrong and what to do about it, in terms a person can act on. */
export function describeError(error: unknown): string {
  if (error instanceof TransactionFailed) {
    const detail = error.detail as { InstructionError?: [number, { Custom?: number } | string] } | undefined;
    const custom = detail?.InstructionError?.[1];
    if (custom && typeof custom === 'object' && typeof custom.Custom === 'number') {
      const known = programErrorMessage(custom.Custom);
      if (known) return `${known}.`;
      return `The program rejected this (error ${custom.Custom}).`;
    }
    return 'The network rejected this transaction. Nothing was changed.';
  }
  if (error instanceof TransactionTimedOut) return 'The network did not confirm this in time. It may still land, so check before trying again.';
  const message = error instanceof Error ? error.message : String(error);
  // Wallets report a failed simulation as text, so the program's own error is read out of it.
  const hex = message.match(/custom program error: 0x([0-9a-f]+)/i);
  if (hex?.[1]) {
    const known = programErrorMessage(parseInt(hex[1], 16));
    if (known) return `${known}.`;
  }
  if (/User rejected|rejected the request|declined|denied|cancel/i.test(message)) return 'You cancelled that in your wallet. Nothing was changed.';
  if (/insufficient (funds|lamports)|Attempt to debit|AccountNotFound|no record of a prior credit/i.test(message)) return 'Not enough SOL for this. Add some and try again.';
  if (/429|Too many/i.test(message)) return 'Too many requests right now. Wait a moment and try again.';
  // A wallet on mainnet can't run a devnet transaction: it fails to simulate, or the blockhash is unknown.
  if (!IS_MAINNET && /simulat|Blockhash not found|blockhash/i.test(message)) return 'Your wallet looks set to a different network. This beta runs on Solana devnet: in Phantom, turn on Testnet Mode (Settings, Developer Settings) and pick Solana Devnet.';
  if (/Blockhash not found|block height exceeded/i.test(message)) return 'The network moved on before this landed. Try again.';
  if (/fetch|network/i.test(message)) return 'Could not reach the network. Check your connection and try again.';
  return 'That did not work. Nothing was changed. Try again.';
}

const isFuelError = (error: unknown) => /insufficient (funds|lamports)|Attempt to debit|AccountNotFound|no record of a prior credit/i.test(error instanceof Error ? error.message : String(error));
const isRevoked = (error: unknown) => {
  const custom = ((error as TransactionFailed)?.detail as { InstructionError?: [number, { Custom?: number }] } | undefined)?.InstructionError?.[1]?.Custom;
  // SessionExpired, SessionRevoked and SessionMismatch: this key can't act any more.
  return error instanceof TransactionFailed && (custom === 6006 || custom === 6007 || custom === 6008);
};

/** Session-key transactions sent from this tab and not confirmed yet. Wallets resend their own; these are ours to resend. */
const unconfirmed = new Map<string, ReturnType<typeof getBase64EncodedWireTransaction>>();
const RESEND_EVERY_MS = 3_000;
const MAX_RESENDS = 10;

async function signAndSubmit(feePayer: TransactionSigner, instructions: readonly Instruction[], computeUnits: number): Promise<Signature> {
  const [blockhash, microLamportsPerUnit] = await Promise.all([latestBlockhash(), priorityFee()]);
  const message = buildMessage({ feePayer, blockhash, instructions, computeUnits, microLamportsPerUnit });
  const signed = await signTransactionMessageWithSigners(message);
  const signature = getSignatureFromTransaction(signed);
  const wire = getBase64EncodedWireTransaction(signed);
  await sendWireTransaction(clientRpc(), wire);
  unconfirmed.set(signature, wire);
  return signature;
}

/**
 * The wallet signs; the app sends, to the cluster it runs on, and resends until it lands. A wallet set
 * to another network (Phantom on mainnet during the devnet beta) would otherwise send it there, where
 * it can never land, and the app would wait forever.
 */
async function walletSend(signer: TransactionSigner, instructions: readonly Instruction[], computeUnits: number): Promise<Signature> {
  const [blockhash, microLamportsPerUnit] = await Promise.all([latestBlockhash(), priorityFee()]);
  const message = buildMessage({ feePayer: signer, blockhash, instructions, computeUnits, microLamportsPerUnit });
  const signed = await signTransactionMessageWithSigners(message);
  const signature = getSignatureFromTransaction(signed);
  const wire = getBase64EncodedWireTransaction(signed);
  await sendWireTransaction(clientRpc(), wire);
  unconfirmed.set(signature, wire);
  return signature;
}

/** After confirmation: index it now and wait briefly, so the refresh that follows already includes it. */
async function ingestNow(signature: string): Promise<void> {
  try {
    await fetch('/api/ingest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signature }), signal: AbortSignal.timeout(6_000) });
  } catch {
    // The webhook and the reconcile job index it anyway.
  }
}

function hintIngest(signature: string): void {
  void fetch('/api/ingest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ signature }),
    keepalive: true,
  }).catch(() => {});
}

async function confirm(signature: Signature): Promise<void> {
  // A busy network can drop a transaction. Resending the same bytes can't act twice: they carry one signature.
  const wire = unconfirmed.get(signature);
  let resends = 0;
  const timer = wire
    ? setInterval(() => {
        if (++resends > MAX_RESENDS) return;
        void sendWireTransaction(clientRpc(), wire, { skipPreflight: true }).catch(() => {});
      }, RESEND_EVERY_MS)
    : null;
  try {
    await waitForConfirmation(clientRpc(), signature);
  } finally {
    if (timer) clearInterval(timer);
    unconfirmed.delete(signature);
    forgetBlockhash();
  }
}

export type NeededSol = { deposit: bigint; rent: bigint; fuel: bigint; total: bigint };

export function useActions() {
  const v = useViewer();

  return useMemo(() => {
    const { profile, pendingProfile, session, walletSigner, account } = v;
    const address = (profile?.address ?? pendingProfile?.address ?? null) as Address | null;

    const refreshFeeds = () => {
      refreshAfterAction();
    };

    /** Every action needs a connected wallet with a handle. This walks someone there. */
    function ready(): boolean {
      if (!account) {
        v.openConnect();
        return false;
      }
      // Just after a page loads, the profile and session key are still being looked up. Acting now
      // would send someone who has a name to the claim page, or ask their wallet to sign a like.
      if (!v.settled) {
        toast('info', 'Still loading your profile. Try again in a second.');
        return false;
      }
      if (!profile?.handle && !pendingProfile?.handle) {
        window.location.assign('/claim');
        return false;
      }
      if (!walletSigner && !session) {
        toast('error', 'Your wallet is still connecting. Try again in a moment.');
        return false;
      }
      return true;
    }

    const signerFields = () =>
      session
        ? { signer: session.signer as TransactionSigner, profile: address as Address, session: undefined as Address | undefined }
        : { signer: walletSigner as TransactionSigner, profile: address as Address, session: undefined as Address | undefined };

    // Set when an action also started this browser's session key; adopted once that transaction lands.
    let adoptAfter: StoredSession | null = null;

    async function social(build: (auth: { signer: TransactionSigner; profile: Address; session?: Address }) => Instruction, computeUnits: number, ownerOnly = false): Promise<Signature> {
      if (ownerOnly) {
        if (!walletSigner) throw new Error('Connect the wallet that owns this profile');
        return walletSend(walletSigner, [build({ signer: walletSigner, profile: address as Address })], computeUnits);
      }
      // No session key in this browser (a new device, or it ran out): start one in the same wallet
      // approval as this action, so it's the only popup. Everything after goes through the key.
      if (!session && v.sessionKeysSupported && walletSigner) {
        const started = await startSessionInstructions(address as Address);
        const instruction = build({ signer: walletSigner, profile: address as Address });
        const signature = await walletSend(walletSigner, [...started.instructions, instruction], COMPUTE_LIMITS.owner + computeUnits);
        adoptAfter = started.stored;
        return signature;
      }
      const fields = signerFields();
      if (session) {
        fields.session = await sessionAddress(address as Address, session.signer.address);
        const instruction = build({ signer: fields.signer, profile: fields.profile, session: fields.session });
        return signAndSubmit(session.signer, [instruction], computeUnits);
      }
      const instruction = build({ signer: fields.signer, profile: fields.profile });
      return walletSend(walletSigner as TransactionSigner, [instruction], computeUnits);
    }

    /** Runs an action through to confirmation and explains any failure. */
    async function run(build: Parameters<typeof social>[0], computeUnits: number, opts: { onFail?: () => void; onSent?: (sig: string) => void; onLanded?: () => void; ownerOnly?: boolean } = {}): Promise<string | null> {
      try {
        const signature = await social(build, computeUnits, opts.ownerOnly);
        opts.onSent?.(signature);
        // The first hint goes out at once with keepalive, so leaving the page can't lose it. The second
        // is free when the first already indexed the transaction.
        hintIngest(signature);
        await confirm(signature);
        if (adoptAfter) {
          const stored = adoptAfter;
          adoptAfter = null;
          await v.adoptSession(stored);
          toast('success', 'Session started on this device. Posts and likes won\'t ask your wallet again.');
        }
        await ingestNow(signature);
        opts.onLanded?.();
        refreshFeeds();
        return signature;
      } catch (error) {
        console.error(error);
        adoptAfter = null;
        opts.onFail?.();
        if (isFuelError(error) && session) {
          toast('error', 'Your session key is out of fee fuel. Top it up in Settings.', { label: 'Open settings', href: '/settings' });
        } else if (isRevoked(error)) {
          await v.dropSession();
          toast('error', 'This session ended. Your next action will ask your wallet.');
        } else {
          toast('error', describeError(error));
        }
        return null;
      }
    }

    const toggle = (sig: string, key: keyof PostOverlay, on: boolean, build: Parameters<typeof social>[0]) => {
      if (!ready()) return;
      setOverlay(sig, { [key]: on });
      void run(build, COMPUTE_LIMITS.social, { onFail: () => setOverlay(sig, { [key]: !on }) });
    };

    async function sessionRentAndFuel(): Promise<{ rent: bigint; fuel: bigint }> {
      const rpc = clientRpc();
      const reserve = await rpc.getMinimumBalanceForRentExemption(0n).send();
      // A session account is 114 bytes on chain. The key itself must stay rent-exempt to pay fees.
      const rent = await rpc.getMinimumBalanceForRentExemption(114n).send();
      const fuel = BigInt(reserve) + SESSION_FUEL_ACTIONS * LAMPORTS_PER_ACTION;
      return { rent: BigInt(rent), fuel: fuel > MAX_FUEL_LAMPORTS ? MAX_FUEL_LAMPORTS : fuel };
    }

    /** Creates a new session key in this browser, in one wallet popup. */
    async function startSessionInstructions(profile: Address): Promise<{ instructions: Instruction[]; stored: StoredSession }> {
      if (!walletSigner) throw new Error('Wallet not connected');
      const keyPair = await generateKeyPair();
      const delegate = await createSignerFromKeyPair(keyPair);
      const session = await sessionAddress(profile, delegate.address);
      const [expiresAt, { fuel }] = await Promise.all([sessionExpiry(), sessionRentAndFuel()]);
      return {
        instructions: [ix.createSession({ authority: walletSigner, profile, delegate: delegate.address, session, expiresAt: BigInt(expiresAt), fuel })],
        stored: { profile, delegate: delegate.address, keyPair, expiresAt },
      };
    }

    return {
      /** Posts, and returns the signature as soon as it is known. */
      async post(input: { text: string; replyTo?: string | null; quoteOf?: string | null }): Promise<boolean> {
        if (!ready()) return false;
        const text = input.text.normalize('NFC').trim();
        if (!text) return false;
        if (new TextEncoder().encode(text).length > MAX_TEXT_BYTES) {
          toast('error', 'That post is too long.');
          return false;
        }
        const size = await socialTransactionSize(
          ix.post({ signer: signerFields().signer, profile: address as Address, ...(session ? { session: await sessionAddress(address as Address, session.signer.address) } : {}), text, replyTo: input.replyTo ?? null, quoteOf: input.quoteOf ?? null }),
          signerFields().signer,
        );
        if (size > MAX_TRANSACTION_BYTES) {
          toast('error', 'That post is too long to fit in one transaction with this reply and quote. Shorten it a little.');
          return false;
        }
        let pendingSig: string | null = null;
        const sig = await run((auth) => ix.post({ ...auth, text, replyTo: input.replyTo ?? null, quoteOf: input.quoteOf ?? null }), COMPUTE_LIMITS.post, {
          onSent: (s) => {
            pendingSig = s;
            addPending({ sig: s, text, replyTo: input.replyTo ?? null, quoteOf: input.quoteOf ?? null, at: Date.now() });
          },
          onFail: () => {
            if (pendingSig) removePending(pendingSig);
          },
          onLanded: announceLanded,
        });
        return sig !== null;
      },

      deletePost(sig: string) {
        if (!ready()) return;
        setOverlay(sig, { deleted: true });
        void run((auth) => ix.deletePost({ ...auth, post: sig }), COMPUTE_LIMITS.social, { ownerOnly: true, onFail: () => setOverlay(sig, { deleted: false }) });
      },
      like: (sig: string, on: boolean) => toggle(sig, 'liked', on, (auth) => (on ? ix.like({ ...auth, post: sig }) : ix.unlike({ ...auth, post: sig }))),
      repost: (sig: string, on: boolean) => toggle(sig, 'reposted', on, (auth) => (on ? ix.repost({ ...auth, post: sig }) : ix.unrepost({ ...auth, post: sig }))),

      async follow(target: string, on: boolean) {
        if (!ready()) return false;
        const sig = await run((auth) => (on ? ix.follow({ ...auth, target: toAddress(target) }) : ix.unfollow({ ...auth, target: toAddress(target) })), COMPUTE_LIMITS.social);
        return sig !== null;
      },

      async pin(sig: string | null) {
        if (!ready()) return;
        const done = await run((auth) => ix.pin({ ...auth, post: sig }), COMPUTE_LIMITS.social);
        if (done) toast('success', sig ? 'Pinned to your profile.' : 'Unpinned.');
      },

      async setProfile(fields: { name: string; bio: string; website: string; location: string; avatarSeed: number; accent: number }) {
        if (!ready()) return false;
        const done = await run((auth) => ix.setProfile({ ...auth, ...fields }), COMPUTE_LIMITS.post);
        if (done) await v.refreshProfile();
        return done !== null;
      },

      bookmark(sig: string, on: boolean) {
        if (!session) {
          if (ready()) toast('error', 'Start a session to use bookmarks. It keeps them private to you.', { label: 'Open settings', href: '/settings' });
          return;
        }
        setOverlay(sig, { bookmarked: on });
        void v.signedFetch('/api/bookmarks', { method: 'POST', body: { post: sig, on } }).then(
          (res) => {
            if (!res.ok) {
              setOverlay(sig, { bookmarked: !on });
              toast('error', 'Could not save that bookmark. Try again.');
            } else {
              refreshAfterAction('/api/bookmarks');
            }
          },
          () => {
            setOverlay(sig, { bookmarked: !on });
            toast('error', 'Could not reach the server. Check your connection and try again.');
          },
        );
      },

      /** What a claim will lock up, read live from the program's constants and the chain's rent. */
      async quoteClaim(deposit: bigint): Promise<NeededSol> {
        const rpc = clientRpc();
        const { rent: sessionRent, fuel } = await sessionRentAndFuel();
        const [profileRent, handleRent] = await Promise.all([rpc.getMinimumBalanceForRentExemption(98n).send(), rpc.getMinimumBalanceForRentExemption(50n).send()]);
        const rent = BigInt(profileRent) + BigInt(handleRent) + sessionRent;
        return { deposit, rent, fuel, total: deposit + rent + fuel };
      },

      /** The whole onboarding in one transaction: profile, handle and a session key. One popup. */
      async claim(handle: string): Promise<string> {
        if (!walletSigner || !account) throw new Error('Connect a wallet first');
        const wallet = walletSigner;
        const profile = await deriveProfile(toAddress(account.address));
        const handleAccount = await handleAddress(handle);
        const existing = await clientRpc().getAccountInfo(profile, { encoding: 'base64', dataSlice: { offset: 0, length: 0 } }).send();
        const instructions: Instruction[] = [
          ...(existing.value ? [] : [ix.createProfile({ authority: wallet, profile })]),
          ix.claimHandle({ authority: wallet, profile, handleAccount, handle }),
        ];
        let stored: StoredSession | null = null;
        if (v.sessionKeysSupported) {
          const started = await startSessionInstructions(profile);
          instructions.push(...started.instructions);
          stored = started.stored;
        }
        const signature = await walletSend(wallet, instructions, COMPUTE_LIMITS.onboarding);
        // The first hint goes out at once with keepalive, so leaving the page can't lose it. The second
        // is free when the first already indexed the transaction.
        hintIngest(signature);
        await confirm(signature);
        await ingestNow(signature);
        if (stored) await v.adoptSession(stored);
        await v.refreshProfile();
        announceLanded();
        return signature;
      },

      /** Starts a session for an existing profile, or renews this browser's key if it still exists. */
      async startSession(): Promise<void> {
        if (!walletSigner || !address) throw new Error('Connect a wallet first');
        const started = await startSessionInstructions(address);
        const signature = await walletSend(walletSigner, started.instructions, COMPUTE_LIMITS.owner);
        // The first hint goes out at once with keepalive, so leaving the page can't lose it. The second
        // is free when the first already indexed the transaction.
        hintIngest(signature);
        await confirm(signature);
        await ingestNow(signature);
        await v.adoptSession(started.stored);
        toast('success', 'Session started. No more wallet popups for social actions.');
      },

      async extendSession(): Promise<void> {
        if (!walletSigner || !address || !session) throw new Error('No session to extend');
        const sessionAcc = await sessionAddress(address, session.signer.address);
        const expiresAt = await sessionExpiry();
        const fuel = SESSION_FUEL_ACTIONS * LAMPORTS_PER_ACTION;
        const signature = await walletSend(walletSigner, [ix.extendSession({ authority: walletSigner, profile: address, delegate: session.signer.address, session: sessionAcc, expiresAt: BigInt(expiresAt), fuel })], COMPUTE_LIMITS.owner);
        // The first hint goes out at once with keepalive, so leaving the page can't lose it. The second
        // is free when the first already indexed the transaction.
        hintIngest(signature);
        await confirm(signature);
        await ingestNow(signature);
        await saveSession({ profile: address, delegate: session.signer.address, keyPair: session.signer.keyPair, expiresAt });
        await v.adoptSession({ profile: address, delegate: session.signer.address, keyPair: session.signer.keyPair, expiresAt });
        toast('success', 'Session extended and topped up.');
      },

      /** Ends one session, and sends this browser's leftover fuel back to the wallet first. */
      async closeSession(sessionAccount: string, delegateAddress: string): Promise<void> {
        if (!walletSigner || !account) throw new Error('Connect a wallet first');
        const thisDevice = session?.address === delegateAddress;
        const signature = await walletSend(walletSigner, [ix.closeSession({ signer: walletSigner, session: toAddress(sessionAccount), rentPayer: toAddress(account.address) })], COMPUTE_LIMITS.owner);
        // The first hint goes out at once with keepalive, so leaving the page can't lose it. The second
        // is free when the first already indexed the transaction.
        hintIngest(signature);
        await confirm(signature);
        await ingestNow(signature);
        if (thisDevice) await v.dropSession();
        toast('success', thisDevice ? 'This device is signed out.' : 'That device is signed out.');
      },

      async revokeAll(): Promise<void> {
        if (!walletSigner || !address) throw new Error('Connect a wallet first');
        const signature = await walletSend(walletSigner, [ix.revokeAllSessions({ authority: walletSigner, profile: address })], COMPUTE_LIMITS.owner);
        // The first hint goes out at once with keepalive, so leaving the page can't lose it. The second
        // is free when the first already indexed the transaction.
        hintIngest(signature);
        await confirm(signature);
        await ingestNow(signature);
        await v.dropSession();
        toast('success', 'Every session key is revoked.');
      },

      async releaseHandle(): Promise<void> {
        if (!walletSigner || !address || !profile?.handle) throw new Error('No handle to release');
        const handleAccount = await handleAddress(profile.handle);
        const signature = await walletSend(walletSigner, [ix.releaseHandle({ authority: walletSigner, profile: address, handleAccount })], COMPUTE_LIMITS.owner);
        // The first hint goes out at once with keepalive, so leaving the page can't lose it. The second
        // is free when the first already indexed the transaction.
        hintIngest(signature);
        await confirm(signature);
        await ingestNow(signature);
        await v.refreshProfile();
        toast('success', 'Handle released. Your deposit and rent are back in your wallet.');
      },
    };
  }, [v]);
}

export type Actions = ReturnType<typeof useActions>;
