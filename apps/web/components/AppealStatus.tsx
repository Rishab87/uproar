'use client';
import { useEffect, useState } from 'react';
import { GAC_PORTAL } from '@/lib/operator';

type Status = { ref: string; status: string; decidedAt: string | null; note: string | null; dueAt: string };

const LABEL: Record<string, string> = { open: 'Under review', upheld: 'Decision upheld', overturned: 'Decision overturned and restored' };

export function AppealStatusView({ refId, token }: { refId: string; token: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch(`/api/appeal?ref=${encodeURIComponent(refId)}&token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const body = (await r.json()) as Status & { error?: string };
        if (!r.ok) setError(body.error ?? 'Could not load this appeal.');
        else setStatus(body);
      })
      .catch(() => setError('Could not load this appeal. Check your connection.'));
  }, [refId, token]);
  if (error) return <p className="form-error" role="alert">{error}</p>;
  if (!status) return <p className="dim">Loading</p>;
  return (
    <div className="result">
      <strong>{status.ref}</strong>
      <dl className="kv">
        <dt>Status</dt><dd data-testid="appeal-status">{LABEL[status.status] ?? status.status}</dd>
        <dt>Decision due</dt><dd>{new Date(status.dueAt).toLocaleDateString()}</dd>
        {status.decidedAt ? <><dt>Decided</dt><dd>{new Date(status.decidedAt).toLocaleString()}</dd></> : null}
        {status.note ? <><dt>Reason given</dt><dd>{status.note}</dd></> : null}
      </dl>
      {status.status === 'upheld' ? <p>You can appeal to the <a href={GAC_PORTAL} target="_blank" rel="noopener noreferrer">Grievance Appellate Committee</a> within 30 days of this decision.</p> : null}
    </div>
  );
}
