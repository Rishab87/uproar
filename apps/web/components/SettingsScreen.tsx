'use client';
import { LABELS } from '@uproar/safety/catalog';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { describeError, useActions } from '@/lib/client/actions';
import { formatSol } from '@/lib/client/config';
import { useApi } from '@/lib/client/data';
import { clientRpc } from '@/lib/client/rpc';
import { toast } from '@/lib/client/stores';
import { useViewer } from '@/lib/client/viewer';
import type { AuthorView, Preferences, SessionView } from '@/lib/server/queries';
import { address as toAddress } from '@solana/kit';
import { BackHead } from './ThreadScreen';

function useBalance(address: string | null, refreshKey: unknown) {
  const [balance, setBalance] = useState<bigint | null>(null);
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    clientRpc().getBalance(toAddress(address)).send().then(
      (r) => { if (!cancelled) setBalance(BigInt(r.value)); },
      () => {},
    );
    return () => { cancelled = true; };
  }, [address, refreshKey]);
  return balance;
}

function Busy({ label, run, className, danger }: { label: string; run: () => Promise<unknown>; className?: string; danger?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={className ?? 'btn'}
      disabled={busy}
      onClick={async () => {
        if (danger && !confirm(danger)) return;
        setBusy(true);
        try {
          await run();
        } catch (error) {
          console.error(error);
          toast('error', describeError(error));
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? 'Waiting for your wallet' : label}
    </button>
  );
}

function SessionSection() {
  const v = useViewer();
  const actions = useActions();
  const { data: sessions, mutate } = useApi<SessionView[]>(v.session && v.profile ? '/api/sessions' : null);
  const fuel = useBalance(v.session?.address ?? null, sessions);
  const daysLeft = v.session ? Math.ceil((v.session.expiresAt * 1000 - Date.now()) / 86_400_000) : 0;
  return (
    <section className="settings-section" id="session">
      <h2>Session key</h2>
      <p className="dim small">A session key lives in this browser and signs social actions, so your wallet doesn&apos;t pop up every time. It can post, like and follow for you. It can&apos;t touch your wallet&apos;s funds, your handle or your other sessions. It expires on its own.</p>
      {!v.sessionKeysSupported ? (
        <p>This browser can&apos;t hold a session key, so your wallet signs each action. Bookmarks and notifications need a newer browser.</p>
      ) : v.session ? (
        <>
          <div className="setting-row">
            <div>
              <strong>This device</strong>
              <span>Expires in {daysLeft} {daysLeft === 1 ? 'day' : 'days'}. {fuel !== null ? `${formatSol(fuel)} SOL of fee fuel left.` : ''}</span>
            </div>
            <Busy label="Extend and top up" run={async () => { await actions.extendSession(); await mutate(); }} />
          </div>
          {(sessions ?? []).filter((s) => s.live).length > 0 ? (
            <div className="stack">
              {(sessions ?? []).filter((s) => s.live).map((s) => (
                <div className="setting-row" key={s.address}>
                  <div>
                    <strong>{s.delegate === v.session?.address ? 'This device' : `Device ${s.delegate.slice(0, 6)}`}</strong>
                    <span>{s.expiresAt ? `Until ${new Date(s.expiresAt).toLocaleDateString()}` : ''}</span>
                  </div>
                  <Busy label="Sign out" run={async () => { await actions.closeSession(s.address, s.delegate); await mutate(); }} />
                </div>
              ))}
            </div>
          ) : null}
          <div className="setting-row">
            <div><strong>Lost a device?</strong><span>This kills every session key at once.</span></div>
            <Busy label="Revoke all sessions" className="btn btn-danger" danger="Revoke every session key on every device?" run={async () => { await actions.revokeAll(); await mutate(); }} />
          </div>
        </>
      ) : (
        <div className="setting-row">
          <div><strong>No session on this device</strong><span>Your wallet will ask you to approve each action.</span></div>
          <Busy label="Start a session" className="btn btn-loud" run={() => actions.startSession()} />
        </div>
      )}
    </section>
  );
}

function FiltersSection() {
  const v = useViewer();
  const { data, mutate } = useApi<Preferences>(v.session && v.profile ? '/api/prefs' : null);
  const [word, setWord] = useState('');
  if (!v.session) return null;
  const send = async (body: Record<string, unknown>) => {
    try {
      const res = await v.signedFetch('/api/prefs', { method: 'POST', body });
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string };
        toast('error', error ?? 'That did not save. Try again.');
      }
    } catch {
      toast('error', 'Could not reach the server. Check your connection and try again.');
    }
    await mutate().catch(() => {});
  };
  const people = (list: AuthorView[], op: string, verb: string) =>
    list.length ? (
      <div className="chips">
        {list.map((a) => (
          <span key={a.address} className="chip">
            {a.handle ? `@${a.handle}` : a.address.slice(0, 6)}
            <button type="button" aria-label={`${verb} ${a.handle ?? a.address}`} onClick={() => send({ op, target: a.address })}>×</button>
          </span>
        ))}
      </div>
    ) : <span className="dim small">Nobody.</span>;
  return (
    <section className="settings-section">
      <h2>What you see</h2>
      <p className="dim small">These settings are private and stay off chain. They only change your own view.</p>
      {Object.entries(LABELS).map(([key, l]) => (
        <div className="setting-row" key={key}>
          <div><strong>{l.label}</strong><span>{l.help}</span></div>
          <div className="segmented" role="group" aria-label={l.label}>
            {(['hide', 'warn', 'show'] as const).map((a) => (
              <button key={a} type="button" aria-pressed={(data?.labels[key] ?? l.defaultAction) === a} onClick={() => send({ op: 'label', label: key, action: a })}>{a[0]?.toUpperCase()}{a.slice(1)}</button>
            ))}
          </div>
        </div>
      ))}
      <h3>Muted words</h3>
      <form className="setting-row" onSubmit={(e) => { e.preventDefault(); if (word.trim()) { void send({ op: 'word_add', word }); setWord(''); } }}>
        <div className="field"><label className="visually-hidden" htmlFor="muted-word">Word to mute</label><input id="muted-word" value={word} maxLength={64} placeholder="Add a word or phrase" onChange={(e) => setWord(e.target.value)} /></div>
        <button type="submit" className="btn">Mute word</button>
      </form>
      {data?.mutedWords.length ? (
        <div className="chips">{data.mutedWords.map((w) => <span key={w} className="chip">{w}<button type="button" aria-label={`Remove ${w}`} onClick={() => send({ op: 'word_remove', word: w })}>×</button></span>)}</div>
      ) : null}
      <h3>Muted accounts</h3>
      {people(data?.mutes ?? [], 'unmute', 'Unmute')}
      <h3>Blocked accounts</h3>
      {people(data?.blocks ?? [], 'unblock', 'Unblock')}
    </section>
  );
}

function AccountSection() {
  const v = useViewer();
  const actions = useActions();
  const balance = useBalance(v.account?.address ?? null, v.profile);
  if (!v.account) return null;
  return (
    <section className="settings-section">
      <h2>Account</h2>
      <div className="setting-row">
        <div>
          <strong>Wallet</strong>
          <span>{v.account.address}{balance !== null ? ` holds ${formatSol(balance)} SOL` : ''}</span>
        </div>
        <button type="button" className="btn" onClick={v.disconnect}>Disconnect</button>
      </div>
      {v.profile?.handle ? (
        <div className="setting-row">
          <div>
            <strong>@{v.profile.handle}</strong>
            <span>Releasing returns your deposit and rent. Anyone can then claim this name. Your old posts stay on your profile address.</span>
          </div>
          <Busy label="Release this name" className="btn btn-danger" danger={`Release @${v.profile.handle}? Anyone can claim it after this, and you can't post until you claim a name again.`} run={() => actions.releaseHandle()} />
        </div>
      ) : (
        <div className="setting-row"><div><strong>No name yet</strong><span>Claim one to post.</span></div><Link prefetch={false} className="btn btn-loud" href="/claim">Claim your name</Link></div>
      )}
    </section>
  );
}

export function SettingsScreen() {
  const v = useViewer();
  return (
    <>
      <BackHead title="Settings" />
      {!v.account ? (
        <div className="feed-empty"><h2>Connect first</h2><button type="button" className="btn btn-loud" onClick={v.openConnect}>Connect wallet</button></div>
      ) : (
        <>
          <AccountSection />
          {v.profile ? <SessionSection /> : null}
          <FiltersSection />
        </>
      )}
      <section className="settings-section">
        <h2>Legal</h2>
        <div className="chips">
          <Link prefetch={false} className="btn" href="/rules">Rules</Link>
          <Link prefetch={false} className="btn" href="/terms">Terms</Link>
          <Link prefetch={false} className="btn" href="/privacy">Privacy</Link>
          <Link prefetch={false} className="btn" href="/grievance">Grievance Officer</Link>
        </div>
      </section>
    </>
  );
}
