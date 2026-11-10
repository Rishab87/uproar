'use client';
import { CATEGORIES } from '@uproar/safety/catalog';
import { useEffect, useState } from 'react';

type Status = { ref: string; status: string; category: string; decision: string | null; decisionReason: string | null; createdAt: string; resolvedAt: string | null };

const DECISIONS: Record<string, string> = {
  removed: 'Hidden on this app',
  withheld: 'Withheld in some countries',
  restored: 'Restored after review',
  no_action: 'No action. It stays up',
  labelled: 'A label was added',
};

export function ReportStatusView({ refId: ref, token }: { refId: string; token: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    fetch(`/api/report/status?ref=${encodeURIComponent(ref)}&token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const body = (await r.json()) as Status & { error?: string };
        if (!r.ok) setError(body.error ?? 'Could not load this report.');
        else setStatus(body);
      })
      .catch(() => setError('Could not load this report. Check your connection.'));

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ref, token]);

  if (error) return <p className="form-error" role="alert">{error}</p>;
  if (!status) return <p className="dim">Loading</p>;
  return (
    <div className="result">
      <strong>{status.ref}</strong>
      <dl className="kv">
        <dt>Reason</dt><dd>{CATEGORIES[status.category]?.label ?? status.category}</dd>
        <dt>Filed</dt><dd>{new Date(status.createdAt).toLocaleString()}</dd>
        <dt>Status</dt><dd data-testid="report-status">{status.status === 'open' ? 'Under review' : status.status === 'withdrawn' ? 'Withdrawn by you' : 'Closed'}</dd>
        {status.decision ? <><dt>Decision</dt><dd>{DECISIONS[status.decision] ?? status.decision}</dd></> : null}
        {status.decisionReason ? <><dt>Reason given</dt><dd>{status.decisionReason}</dd></> : null}
      </dl>
      {status.status === 'open' && status.category !== 'child_safety' ? (
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const res = await fetch('/api/report/withdraw', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ref, token }) });
              if (!res.ok) setError('This report can no longer be withdrawn.');
              await load();
            } catch {
              setError('Could not reach the server. Check your connection and try again.');
            } finally {
              setBusy(false);
            }
          }}
        >
          Withdraw this report
        </button>
      ) : null}
    </div>
  );
}
