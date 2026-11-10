'use client';
import { useSignMessage } from '@solana/react';
import { CATEGORIES, LABELS } from '@uproar/safety/catalog';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import type { UiWalletAccount } from '@wallet-standard/react';
import { toast } from '@/lib/client/stores';
import { useViewer } from '@/lib/client/viewer';
import { ConnectOnly } from './ConnectOnly';
import { Wordmark } from './Shell';

type Item = { kind: 'report' | 'order' | 'data_request' | 'appeal'; ref: string; dueAt: string; createdAt: string; title: string; severity: string };
type Alert = { id: string; severity: string; subject: string; last_sent_at: string | null; last_error: string | null };
type ActiveOrder = { ref: string; authority: string; reference: string; kind: string; actionedAt: string | null };
type QueueData = { admin: string; items: Item[]; alerts: Alert[]; orders: ActiveOrder[] };

const jsonFetch = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error('request failed') as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
};

async function post(url: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return { ok: false, error: data.error ?? 'That did not work.' };
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not reach the server. Check your connection and try again.' };
  }
}

function dueText(iso: string, now: number): { text: string; late: boolean } {
  const ms = new Date(iso).getTime() - now;
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const span = h >= 48 ? `${Math.floor(h / 24)}d ${h % 24}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  return ms < 0 ? { text: `${span} overdue`, late: true } : { text: `${span} left`, late: false };
}

function Login({ account, onDone }: { account: UiWalletAccount; onDone: () => void }) {
  const signMessage = useSignMessage(account);
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-loud"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const res = await fetch('/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ step: 'nonce' }) });
          const start = (await res.json()) as { nonce: string; message: string; error?: string };
          if (!res.ok) throw new Error(start.error ?? 'Sign-in failed');
          const { signature } = await signMessage({ message: new TextEncoder().encode(start.message) });
          const verify = await post('/api/admin/login', { step: 'verify', wallet: account.address, nonce: start.nonce, signature: btoa(String.fromCharCode(...signature)) });
          if (!verify.ok) throw new Error(verify.error);
          onDone();
        } catch (error) {
          toast('error', error instanceof Error ? error.message : 'Sign-in failed');
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? 'Waiting for your wallet' : 'Sign in with this wallet'}
    </button>
  );
}

function Health() {
  const { data, mutate } = useSWR<{
    alarms: { telegram: boolean; email: boolean; configured: boolean };
    cron: boolean;
    cluster: string;
    events: { n: number; latest: string | null };
    unfinalized: number;
    chainSlot: number | null;
    audit: { ok: boolean; rows: number };
    chainState: { key: string; updated_at: string }[];
  }>('/api/admin/health', jsonFetch, { refreshInterval: 30_000 });
  if (!data) return null;
  const heartbeat = data.chainState.find((c) => c.key === 'last_maintenance')?.updated_at;
  const stale = !heartbeat || Date.now() - new Date(heartbeat).getTime() > 5 * 60_000;
  return (
    <section className="admin-panel">
      <h2>System</h2>
      <dl className="kv">
        <dt>Alarms</dt><dd className={data.alarms.configured ? 'health-ok' : 'health-bad'} data-testid="health-alarms">{data.alarms.configured ? `On: ${[data.alarms.telegram ? 'Telegram' : '', data.alarms.email ? 'email' : ''].filter(Boolean).join(', ')}` : 'NOT CONFIGURED. Legal clocks can be missed.'}</dd>
        <dt>Heartbeat</dt><dd className={stale ? 'health-bad' : 'health-ok'}>{heartbeat ? new Date(heartbeat).toLocaleString() : 'Never ran'}</dd>
        <dt>Audit chain</dt><dd className={data.audit.ok ? 'health-ok' : 'health-bad'} data-testid="health-audit">{data.audit.ok ? `Intact, ${data.audit.rows} entries` : 'BROKEN. History was altered.'}</dd>
        <dt>Indexed</dt><dd>{data.events.n} events, up to slot {data.events.latest ?? 'none'}. Chain is at {data.chainSlot ?? 'unknown'}.</dd>
        <dt>Not finalized</dt><dd>{data.unfinalized}</dd>
        <dt>Cluster</dt><dd>{data.cluster}</dd>
      </dl>
      <button type="button" className="btn" onClick={async () => { const r = await post('/api/admin/health', {}); toast(r.ok ? 'success' : 'error', r.ok ? 'Maintenance ran.' : (r.error ?? 'Failed')); await mutate(); }}>Run maintenance now</button>
    </section>
  );
}

function ActionForm({ onDone, target: initial = '', targetType: initialType = 'post' }: { onDone: () => void; target?: string; targetType?: string }) {
  const [op, setOp] = useState('hide');
  const [targetType, setType] = useState(initialType);
  const [target, setTarget] = useState(initial);
  const [note, setNote] = useState('');
  const [publicNote, setPublicNote] = useState('');
  const [countries, setCountries] = useState('');
  const [labelKey, setLabel] = useState('adult');
  const [reasonCode, setReason] = useState('threat');
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await post('/api/admin/action', { op, targetType, target, note, publicNote, reasonCode, label: labelKey, countries: countries.split(/[\s,]+/).filter(Boolean), publishTarget: !CATEGORIES[reasonCode]?.privateTarget });
        toast(r.ok ? 'success' : 'error', r.ok ? 'Done. It is in the audit log.' : (r.error ?? 'Failed'));
        if (r.ok) {
          setNote('');
          setPublicNote('');
          onDone();
        }
      }}
    >
      <div className="field"><label htmlFor="op">Action</label><select id="op" value={op} onChange={(e) => setOp(e.target.value)}>
        <option value="hide">Hide everywhere</option><option value="unhide">Restore</option><option value="withhold">Withhold by country</option><option value="unwithhold">Lift withholding</option><option value="label">Add label</option><option value="unlabel">Remove label</option>
      </select></div>
      <div className="field"><label htmlFor="ttype">Target</label><select id="ttype" value={targetType} onChange={(e) => setType(e.target.value)}><option value="post">Post</option><option value="profile">Account</option></select></div>
      <div className="field"><label htmlFor="tid">Post ID or account address</label><input id="tid" value={target} onChange={(e) => setTarget(e.target.value)} required /></div>
      {op === 'hide' || op === 'withhold' ? (
        <div className="field"><label htmlFor="rc">Reason shown publicly</label><select id="rc" value={reasonCode} onChange={(e) => setReason(e.target.value)}>
          {Object.entries(CATEGORIES).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
          <option value="legal_order">A legal order</option>
        </select></div>
      ) : null}
      {op === 'withhold' || op === 'unwithhold' ? <div className="field"><label htmlFor="cc">Countries</label><input id="cc" value={countries} placeholder="IN" onChange={(e) => setCountries(e.target.value)} required /></div> : null}
      {op === 'label' || op === 'unlabel' ? <div className="field"><label htmlFor="lb">Label</label><select id="lb" value={labelKey} onChange={(e) => setLabel(e.target.value)}>{Object.entries(LABELS).map(([k, l]) => <option key={k} value={k}>{l.label}</option>)}</select></div> : null}
      {op === 'hide' ? <div className="field"><label htmlFor="pn">Public note on the tombstone (optional)</label><input id="pn" value={publicNote} onChange={(e) => setPublicNote(e.target.value)} /></div> : null}
      <div className="field"><label htmlFor="nt">Why (recorded in the audit log)</label><input id="nt" value={note} onChange={(e) => setNote(e.target.value)} required /></div>
      <button type="submit" className="btn btn-loud">Apply</button>
    </form>
  );
}

function Detail({ kind, refId, onDone }: { kind: Item['kind']; refId: string; onDone: () => void }) {
  const { data, mutate } = useSWR<{ item: Record<string, unknown>; content: Record<string, unknown>[]; history: Record<string, unknown>[] }>(`/api/admin/item?kind=${kind}&ref=${refId}`, jsonFetch);
  const [reason, setReason] = useState('');
  const [countries, setCountries] = useState('IN');
  const [falseReport, setFalse] = useState(false);
  const [external, setExternal] = useState('');
  const [publish, setPublish] = useState(false);
  const [labelKey, setLabel] = useState('adult');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setReason('');
    setFalse(false);
    setExternal('');
  }, [refId]);
  // Court orders are published by default. Government and police orders aren't: Section 69A blocking
  // orders must be kept confidential.
  const orderKind = data?.item.kind;
  useEffect(() => {
    if (typeof orderKind === 'string') setPublish(orderKind === 'court');
  }, [orderKind]);

  if (!data) return <section className="admin-panel"><p className="dim">Loading</p></section>;
  const item = data.item;

  const decide = async (extra: Record<string, unknown>) => {
    setBusy(true);
    const r = await post('/api/admin/decide', { kind, ref: refId, ...extra });
    setBusy(false);
    toast(r.ok ? 'success' : 'error', r.ok ? 'Decision recorded.' : (r.error ?? 'Failed'));
    if (r.ok) {
      await mutate();
      onDone();
    }
  };

  const fields = Object.entries(item).filter(([k, v]) => v !== null && v !== '' && !['id', 'status_token_hash', 'targets', 'reporter_key'].includes(k));

  return (
    <section className="admin-panel" data-testid="admin-detail">
      <h2>{refId}</h2>
      <dl className="kv">
        {fields.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k.replaceAll('_', ' ')}</dt><dd>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd></div>)}
      </dl>
      {data.content.map((c) => {
        const p = c.post as { text?: string; handle?: string; deleted?: boolean } | null | undefined;
        const prof = c.profile as { handle?: string; name?: string; bio?: string } | null | undefined;
        const state = c.state as { hidden: boolean; withheldCountries: string[]; reasonCode: string | null };
        return (
          <div key={String(c.target)} className="callout">
            <p className="small dim">Target {String(c.type)}: <Link prefetch={false} href={c.type === 'post' ? `/post/${String(c.target)}` : '#'}>{String(c.target).slice(0, 18)}</Link></p>
            <p className="small">{state.hidden ? 'Hidden' : 'Visible'}{state.withheldCountries.length ? `, withheld in ${state.withheldCountries.join(', ')}` : ''}{state.reasonCode ? ` (${state.reasonCode})` : ''}</p>
            {p ? <p style={{ whiteSpace: 'pre-wrap' }} data-testid="admin-post-text">{p.text}</p> : null}
            {p?.handle ? <p className="small dim">by @{p.handle}{p.deleted ? ', deleted by author' : ''}</p> : null}
            {prof ? <p>@{prof.handle} {prof.name}<br />{prof.bio}</p> : null}
            {p === null ? <p className="small dim">Not indexed. It may not exist.</p> : null}
          </div>
        );
      })}

      {item.status === 'open' || item.status === 'received' ? (
        <div className="form">
          <div className="field"><label htmlFor="reason">{kind === 'report' ? 'Written reason (the reporter sees this)' : 'Written note'}</label><textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          {kind === 'report' ? (
            <>
              {item.category === 'child_safety' ? <div className="field"><label htmlFor="ext">cybercrime.gov.in reference</label><input id="ext" value={external} onChange={(e) => setExternal(e.target.value)} /><small>Report at cybercrime.gov.in first, then record the reference here.</small></div> : null}
              <div className="field"><label htmlFor="cc2">Countries, for withhold</label><input id="cc2" value={countries} onChange={(e) => setCountries(e.target.value)} /></div>
              <div className="field"><label htmlFor="lb2">Label, for add label</label><select id="lb2" value={labelKey} onChange={(e) => setLabel(e.target.value)}>{Object.entries(LABELS).map(([k, l]) => <option key={k} value={k}>{l.label}</option>)}</select></div>
              <label className="consent" style={{ marginLeft: 0 }}><input type="checkbox" checked={falseReport} onChange={(e) => setFalse(e.target.checked)} /><span>This complaint was false. It counts against the filer.</span></label>
              <div className="chips">
                <button type="button" className="btn btn-loud" disabled={busy} onClick={() => decide({ decision: 'removed', reason, falseReport, externalReportRef: external })}>Hide it</button>
                <button type="button" className="btn" disabled={busy} onClick={() => decide({ decision: 'withheld', reason, falseReport, countries: countries.split(/[\s,]+/).filter(Boolean) })}>Withhold</button>
                <button type="button" className="btn" disabled={busy} onClick={() => decide({ decision: 'labelled', reason, falseReport, label: labelKey })}>Add label</button>
                <button type="button" className="btn btn-cyan" disabled={busy} onClick={() => decide({ decision: 'restored', reason, falseReport })}>Restore</button>
                <button type="button" className="btn" disabled={busy} onClick={() => decide({ decision: 'no_action', reason, falseReport })}>No action</button>
              </div>
            </>
          ) : null}
          {kind === 'order' ? (
            <>
              <label className="consent" style={{ marginLeft: 0 }}><input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} /><span>Publish in the transparency log. Off by default for government and police orders, which are usually confidential.</span></label>
              <div className="chips">
                <button type="button" className="btn btn-loud" disabled={busy} onClick={() => decide({ status: 'actioned', note: reason, publish })}>Verified: act on it</button>
                <button type="button" className="btn" disabled={busy} onClick={() => decide({ status: 'rejected', note: reason, publish })}>Reject</button>
                <button type="button" className="btn" disabled={busy} onClick={() => decide({ status: 'challenged', note: reason, publish })}>Challenge in court</button>
              </div>
            </>
          ) : null}
          {kind === 'data_request' ? (
            <div className="chips">
              <a className="btn" href={`/api/admin/export?subject=${encodeURIComponent(String(item.subject ?? ''))}`} target="_blank" rel="noopener noreferrer">Export what we hold</a>
              <button type="button" className="btn btn-loud" disabled={busy} onClick={() => decide({ status: 'responded', note: reason })}>Mark answered</button>
              <button type="button" className="btn" disabled={busy} onClick={() => decide({ status: 'rejected', note: reason })}>Refuse</button>
            </div>
          ) : null}
          {kind === 'appeal' ? (
            <div className="chips">
              <button type="button" className="btn btn-cyan" disabled={busy} onClick={() => decide({ status: 'overturned', note: reason })}>Overturn and restore</button>
              <button type="button" className="btn" disabled={busy} onClick={() => decide({ status: 'upheld', note: reason })}>Uphold</button>
            </div>
          ) : null}
        </div>
      ) : null}

      {data.history.length ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>When</th><th>Action</th><th>By</th><th>Note</th></tr></thead>
            <tbody>
              {data.history.map((h, i) => <tr key={i}><td>{new Date(String(h.at)).toLocaleString()}</td><td>{String(h.action)}</td><td>{String(h.actor).slice(0, 8)}</td><td>{String(h.note ?? '')}</td></tr>)}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

export function AdminConsole() {
  const v = useViewer();
  const { data, error, mutate } = useSWR<QueueData>('/api/admin/queue', jsonFetch, { refreshInterval: 15_000, shouldRetryOnError: false });
  const [open, setOpen] = useState<{ kind: Item['kind']; ref: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const refresh = useCallback(() => void mutate(), [mutate]);
  const items = useMemo(() => data?.items ?? [], [data]);
  const unauthorized = (error as { status?: number } | undefined)?.status === 401;

  if (!data) {
    return (
      <div className="admin">
        <div className="admin-top"><Wordmark /></div>
        <section className="admin-panel">
          <h2>Operator console</h2>
          {!unauthorized && !error ? <p className="dim">Loading</p> : (
            <>
              <p className="dim">Sign in with an operator wallet.</p>
              {v.account ? <Login account={v.account} onDone={refresh} /> : <button type="button" className="btn btn-loud" onClick={v.openConnect}>Connect wallet</button>}
            </>
          )}
        </section>
        <ConnectOnly />
      </div>
    );
  }

  return (
    <div className="admin">
      <div className="admin-top">
        <Wordmark />
        <div className="chips">
          <span className="chip">{data.admin.slice(0, 8)}</span>
          <Link prefetch={false} className="btn" href="/transparency">Public log</Link>
          <button type="button" className="btn" onClick={async () => { await post('/api/admin/logout', {}); await mutate(undefined, { revalidate: true }); }}>Sign out</button>
        </div>
      </div>
      {data.alerts.length ? (
        <section className="admin-panel">
          <h2>Open alarms</h2>
          {data.alerts.map((a) => (
            <div key={a.id} className="setting-row">
              <div><strong>{a.severity.toUpperCase()}: {a.subject}</strong><span>{a.last_error ? `Delivery failing: ${a.last_error}` : a.last_sent_at ? `Last sent ${new Date(a.last_sent_at).toLocaleTimeString()}` : 'Not sent yet'}</span></div>
              <button type="button" className="btn" onClick={async () => { await post('/api/admin/alert', { id: a.id }); await mutate(); }}>Acknowledge</button>
            </div>
          ))}
        </section>
      ) : null}
      <div className="admin-grid">
        <div className="stack">
          <section className="admin-panel">
            <h2>Queue</h2>
            {items.length === 0 ? <p className="dim" data-testid="queue-empty">Nothing waiting.</p> : null}
            <div className="stack" style={{ gap: 6 }} data-testid="queue">
              {items.map((i) => {
                const due = dueText(i.dueAt, now);
                return (
                  <button key={i.ref} type="button" className={`queue-item ${i.severity}${open?.ref === i.ref ? ' is-open' : ''}`} onClick={() => setOpen({ kind: i.kind, ref: i.ref })}>
                    <strong>{i.title}</strong>
                    <small>{i.ref} <span className={due.late ? 'due-late' : ''}>{due.text}</span></small>
                  </button>
                );
              })}
            </div>
          </section>
          <Health />
        </div>
        <div className="stack">
          {open ? <Detail kind={open.kind} refId={open.ref} onDone={refresh} /> : null}
          {data.orders.length ? (
            <section className="admin-panel">
              <h2>Orders in force</h2>
              {data.orders.map((o) => (
                <div key={o.ref} className="setting-row">
                  <div><strong>{o.authority}</strong><span>{o.reference}, {o.ref}</span></div>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={async () => {
                      const note = window.prompt(`Lift ${o.ref}? Write why, for example the court ruling that set it aside.`);
                      if (!note?.trim()) return;
                      const r = await post('/api/admin/decide', { kind: 'order_lift', ref: o.ref, note });
                      toast(r.ok ? 'success' : 'error', r.ok ? 'Order lifted.' : (r.error ?? 'Failed'));
                      await mutate();
                    }}
                  >
                    Lift
                  </button>
                </div>
              ))}
            </section>
          ) : null}
          <section className="admin-panel">
            <h2>Direct action</h2>
            <p className="dim small">For what you see without a report. Everything here goes in the audit log and the public log.</p>
            <ActionForm onDone={refresh} />
          </section>
        </div>
      </div>
      <ConnectOnly />
    </div>
  );
}
