'use client';
import { useState } from 'react';
import { GAC_PORTAL } from '@/lib/operator';
import { useViewer } from '@/lib/client/viewer';
import { Field } from './Field';

export function AppealForm({ initialType, initialTarget }: { initialType: 'post' | 'profile'; initialTarget: string }) {
  const v = useViewer();
  const [type, setType] = useState<string>(initialType);
  const [target, setTarget] = useState(initialTarget);
  const [email, setEmail] = useState('');
  const [statement, setStatement] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filed, setFiled] = useState<{ ref: string; dueAt: string; token: string } | null>(null);

  if (filed) {
    return (
      <div className="result" data-testid="appeal-filed">
        <strong>Appeal received: {filed.ref}</strong>
        <p>You will have a written decision by {new Date(filed.dueAt).toLocaleDateString()}. If you disagree with it, you can go to the <a href={GAC_PORTAL} target="_blank" rel="noopener noreferrer">Grievance Appellate Committee</a> within 30 days.</p>
        <p>Keep this private link. It shows the decision when it's made. It won&apos;t be shown again.</p>
        <p><code data-testid="appeal-status-url">{`/appeal/status?ref=${encodeURIComponent(filed.ref)}&token=${encodeURIComponent(filed.token)}`}</code></p>
        <a className="btn" href={`/appeal/status?ref=${encodeURIComponent(filed.ref)}&token=${encodeURIComponent(filed.token)}`}>Check status</a>
      </div>
    );
  }

  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const res = await v.signedFetch('/api/appeal', { method: 'POST', body: { targetType: type, target: target.trim(), email, statement } });
          const body = (await res.json()) as { ref: string; dueAt: string; token: string; error?: string };
          if (!res.ok) setError(body.error ?? 'The appeal did not go through. Try again.');
          else setFiled(body);
        } catch {
          setError('The appeal did not go through. Check your connection and try again.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="What are you appealing?">
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="post">A post</option>
          <option value="profile">An account</option>
        </select>
      </Field>
      <Field label={type === 'post' ? 'Post ID' : 'Account address'}><input value={target} required onChange={(e) => setTarget(e.target.value)} /></Field>
      <Field label="Email" hint="We send the decision here."><input type="email" value={email} required onChange={(e) => setEmail(e.target.value)} /></Field>
      <Field label="Why was this decision wrong?"><textarea value={statement} required maxLength={2000} onChange={(e) => setStatement(e.target.value)} /></Field>
      {v.session ? <p className="dim small">You&apos;re signed in, so if this is your own post or account, it will be marked as coming from the author.</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button type="submit" className="btn btn-loud" disabled={busy}>{busy ? 'Sending' : 'Send appeal'}</button>
    </form>
  );
}
