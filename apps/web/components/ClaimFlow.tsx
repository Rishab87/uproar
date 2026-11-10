'use client';
import { handleDeposit, isValidHandle, normalizeHandle } from '@uproar/protocol';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { describeError, useActions, type NeededSol } from '@/lib/client/actions';
import { CLUSTER, IS_MAINNET, formatSol } from '@/lib/client/config';
import { clientRpc } from '@/lib/client/rpc';
import { useViewer } from '@/lib/client/viewer';
import { address as toAddress } from '@solana/kit';
import { SignBanner } from './SignBanner';
import { signShareHref } from '@/lib/client/share';

type Check = { handle: string; valid: boolean; available: boolean } | null;

const CHECK_TRIES = 3;

function useHandleCheck(handle: string): { check: Check; checking: boolean; failed: boolean; retry: () => void } {
  const [check, setCheck] = useState<Check>(null);
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [round, setRound] = useState(0);
  useEffect(() => {
    setCheck(null);
    setFailed(false);
    if (!isValidHandle(handle)) {
      setChecking(false);
      return;
    }
    setChecking(true);
    let cancelled = false;
    const controller = new AbortController();
    // A slow or failed answer is asked again, so the form never waits on a check that won't come.
    const run = async () => {
      for (let attempt = 1; attempt <= CHECK_TRIES; attempt++) {
        try {
          const res = await fetch(`/api/handle/check?h=${encodeURIComponent(handle)}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const c = (await res.json()) as NonNullable<Check>;
          if (!cancelled) setCheck(c);
          break;
        } catch {
          if (cancelled) return;
          if (attempt === CHECK_TRIES) setFailed(true);
          else await new Promise((r) => setTimeout(r, 800 * attempt));
        }
      }
      if (!cancelled) setChecking(false);
    };
    const t = setTimeout(() => void run(), 350);
    return () => { cancelled = true; controller.abort(); clearTimeout(t); };
  }, [handle, round]);
  return { check, checking, failed, retry: () => setRound((n) => n + 1) };
}

export function ClaimFlow({ initialHandle = '' }: { initialHandle?: string }) {
  const v = useViewer();
  const actions = useActions();
  const router = useRouter();
  const [input, setInput] = useState(initialHandle);
  const handle = normalizeHandle(input);
  const { check, checking, failed, retry } = useHandleCheck(handle);
  const [quote, setQuote] = useState<NeededSol | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimed, setClaimed] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [slash, setSlash] = useState(false);

  const available = check?.handle === handle && check.valid && check.available;

  useEffect(() => {
    setQuote(null);
    if (!available) return;
    let cancelled = false;
    actions.quoteClaim(handleDeposit(handle)).then((q) => { if (!cancelled) setQuote(q); }, () => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available, handle]);

  const refreshBalance = (): Promise<bigint | undefined> => {
    if (!v.account) return Promise.resolve(undefined);
    return clientRpc().getBalance(toAddress(v.account.address)).send().then((r) => {
      const now = BigInt(r.value);
      setBalance(now);
      return now;
    }, () => undefined);
  };
  useEffect(() => { void refreshBalance(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [v.account?.address]);

  // Someone who already has a name is sent to it. Not someone who just claimed one here, though:
  // their profile appears mid-claim, and they should see the result first.
  const existing = v.profile?.handle ?? v.pendingProfile?.handle;
  useEffect(() => {
    if (existing && !claimed && !started) router.replace(`/@${existing}`);
  }, [existing, claimed, started, router]);

  const enough = quote && balance !== null ? balance >= quote.total + 20_000n : true;

  // The app's own tap: the public test clusters closed their airdrops, so it pays from its wallet.
  const faucet = async () => {
    if (!v.account) return;
    const elsewhere = 'Get free test SOL at faucet.solana.com, then come back.';
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/faucet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: v.account.address }) });
      const out = (await res.json().catch(() => ({}))) as { status?: string };
      if (out.status !== 'sent' && out.status !== 'not_needed') {
        setError(
          out.status === 'already_sent' ? `This wallet already got test SOL from us. ${elsewhere}`
          : out.status === 'limited' ? `Too many test SOL requests from here today. ${elsewhere}`
          : `Our test SOL ran out for now. ${elsewhere}`,
        );
        return;
      }
      // The transfer has landed, but the node the page reads from can be a moment behind.
      const needed = quote ? quote.total + 20_000n : 0n;
      let now: bigint | undefined;
      for (let i = 0; i < 10; i++) {
        now = await refreshBalance();
        if (now !== undefined && now >= needed) return;
        await new Promise((r) => setTimeout(r, 1_000));
      }
      if (out.status === 'not_needed' || (now !== undefined && now > 0n)) setError(`This name needs more test SOL than we hand out. ${elsewhere}`);
    } catch {
      setError(`Could not reach our test SOL tap. ${elsewhere}`);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setStarted(true);
    setError(null);
    try {
      await actions.claim(handle);
      setSlash(true);
      setTimeout(() => setSlash(false), 800);
      setClaimed(handle);
    } catch (e) {
      console.error(e);
      setError(describeError(e));
      setStarted(false);
    } finally {
      setBusy(false);
    }
  };

  if (claimed) {
    return (
      <div className="claim-card" data-testid="claim-done">
        {slash ? <div className="slash" aria-hidden="true"><i /><i /><i /><i /></div> : null}
        <SignBanner handle={claimed} accent={0} />
        <h1 className="claim-title">It&apos;s yours</h1>
        <p>@{claimed} is on chain, and it now has a neon sign in the city. Share it so people can find you.</p>
        <div className="hero-cta" style={{ marginTop: 0 }}>
          <a className="btn btn-loud" href={signShareHref(claimed)} target="_blank" rel="noopener noreferrer">Share my sign</a>
          <Link prefetch={false} className="btn" href="/home">Go to the feed</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="claim-card">
      <h1 className="claim-title">Claim your name</h1>
      {!v.ready ? (
        <p className="dim">Checking your wallet</p>
      ) : !v.account ? (
        <>
          <p className="dim">Your name lives on Solana, under your wallet. You can release it for your deposit back whenever you like.</p>
          <button type="button" className="btn btn-loud btn-block" onClick={v.openConnect}>Connect wallet</button>
        </>
      ) : (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            if (available && agreed && enough && !busy) void submit();
          }}
        >
          <div>
            <label className="visually-hidden" htmlFor="handle">Your name</label>
            <div className="handle-input">
              <span>@</span>
              <input id="handle" autoFocus autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={16} value={input} placeholder="yourname" onChange={(e) => setInput(e.target.value)} />
            </div>
            <p className={`handle-status ${available ? 'ok' : handle && !checking ? 'no' : ''}`} aria-live="polite">
              {!handle ? ' ' : !isValidHandle(handle) ? '3 to 15 characters: a to z, 0 to 9 and underscore.' : failed ? (
                <>The chain didn&apos;t answer. <button type="button" className="link-button" onClick={retry}>Check again</button></>
              ) : checking || !check ? 'Checking the chain' : available ? `@${handle} is free.` : `@${handle} is taken.`}
            </p>
          </div>
          {available && quote ? (
            <div className="claim-costs">
              <div><span>Refundable deposit</span><span>{formatSol(quote.deposit)} SOL</span></div>
              <div><span>Refundable account rent</span><span>{formatSol(quote.rent)} SOL</span></div>
              <div><span>Fees for about 200 actions</span><span>{formatSol(quote.fuel)} SOL</span></div>
              <div className="total"><span>Total from your wallet</span><span>{formatSol(quote.total)} SOL</span></div>
            </div>
          ) : null}
          {available && !enough && balance !== null && quote ? (
            <div className="callout">
              <p>Your wallet holds {formatSol(balance)} SOL. Add at least {formatSol(quote.total + 20_000n - balance)} SOL to continue.</p>
              {!IS_MAINNET ? <button type="button" className="btn" style={{ marginTop: 8 }} disabled={busy} onClick={faucet}>Get free test SOL</button> : null}
            </div>
          ) : null}
          <label className="consent" style={{ marginLeft: 0 }}>
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            <span>I am 18 or older and I accept the <Link prefetch={false} href="/terms" target="_blank">Terms</Link> and <Link prefetch={false} href="/rules" target="_blank">Rules</Link>. What I post is written to Solana. Deleting a post hides it here, but nobody can erase it from the chain.</span>
          </label>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button type="submit" className="btn btn-loud btn-block" style={{ minHeight: 52 }} disabled={!available || !agreed || !enough || busy}>
            {busy ? 'Approve in your wallet' : `Claim${available ? ` @${handle}` : ''}`}
          </button>
          <p className="dim small">One wallet approval. It creates your name and a session key, so day-to-day actions don&apos;t need another popup.</p>
          {!IS_MAINNET ? <p className="dim small">This beta runs on Solana {CLUSTER} with free test SOL. In Phantom, turn on Testnet Mode first (Settings, Developer Settings) and pick Solana Devnet, or the wallet will warn and fail.</p> : null}
        </form>
      )}
    </div>
  );
}
