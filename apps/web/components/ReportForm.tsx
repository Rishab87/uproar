'use client';
import { CATEGORIES } from '@uproar/safety/catalog';
import { useState } from 'react';
import { CYBERCRIME_PORTAL } from '@/lib/operator';
import { Field } from './Field';

type Filed = { ref: string; token: string; autoHidden: boolean; rule: string; resolveDueAt: string; category: string };

function clockText(ms: number): string {
  if (ms === 0) return 'Reviewed immediately';
  const hours = ms / 3_600_000;
  if (hours < 48) return `Decided within ${hours} hours`;
  return `Decided within ${Math.round(hours / 24)} days`;
}

function fromUrl(value: string): { type: 'post' | 'profile'; target: string } | null {
  const v = value.trim();
  if (!v) return null;
  const post = v.match(/\/post\/([1-9A-HJ-NP-Za-km-z]{64,90})/);
  if (post?.[1]) return { type: 'post', target: post[1] };
  if (/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(v)) return { type: 'post', target: v };
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) return { type: 'profile', target: v };
  return null;
}

export function ReportForm({ type, presetTarget }: { type: 'post' | 'profile'; presetTarget: string }) {
  const [link, setLink] = useState(presetTarget);
  const [category, setCategory] = useState('');
  const [details, setDetails] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [onBehalf, setOnBehalf] = useState(false);
  const [declaration, setDeclaration] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filed, setFiled] = useState<Filed | null>(null);
  const [copied, setCopied] = useState(false);

  const chosen = CATEGORIES[category];
  const target = presetTarget ? { type, target: presetTarget } : fromUrl(link);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetType: target?.type, target: target?.target, category, details, email, name, onBehalf, declaration }),
      });
      const body = (await res.json()) as Filed & { error?: string };
      if (!res.ok) setError(body.error ?? 'The report did not go through. Try again.');
      else setFiled(body);
    } catch {
      setError('The report did not go through. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  if (filed) {
    const statusUrl = `/report/status?ref=${encodeURIComponent(filed.ref)}&token=${encodeURIComponent(filed.token)}`;
    return (
      <div className="result" data-testid="report-filed">
        <strong>Report received: {filed.ref}</strong>
        <p>{filed.autoHidden ? 'The post is hidden on this app while we review it.' : 'It stays visible while we review it.'} {CATEGORIES[filed.category]?.clockMs ? `You will have a decision by ${new Date(filed.resolveDueAt).toLocaleString()}.` : 'We are reviewing it now.'}</p>
        {filed.category === 'child_safety' ? <p>You can also report directly to the authorities at <a href={CYBERCRIME_PORTAL} target="_blank" rel="noopener noreferrer">cybercrime.gov.in</a>.</p> : null}
        <p>Keep this private link. It shows your report&apos;s status and lets you withdraw it. It won&apos;t be shown again.</p>
        <p><code data-testid="report-status-url">{statusUrl}</code></p>
        <div className="chips">
          <a className="btn" href={statusUrl}>Check status</a>
          <button type="button" className="btn" onClick={async () => { await navigator.clipboard.writeText(`${window.location.origin}${statusUrl}`); setCopied(true); }}>{copied ? 'Copied' : 'Copy link'}</button>
        </div>
      </div>
    );
  }

  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      {presetTarget ? null : (
        <Field label="Link to the post, or the account address" error={link && !target ? 'That doesn\'t look like a post link or an account address.' : null}>
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste a link" />
        </Field>
      )}
      <fieldset style={{ border: 0, padding: 0, margin: 0 }} className="field">
        <legend style={{ fontWeight: 600, fontSize: 14, marginBottom: 6, padding: 0 }}>What is wrong?</legend>
        <div className="choice-list">
          {Object.entries(CATEGORIES).map(([key, c]) => (
            <label className="choice" key={key}>
              <input type="radio" name="category" value={key} checked={category === key} onChange={() => setCategory(key)} />
              <span><strong>{c.label}</strong><span>{c.help} {clockText(c.clockMs)}.</span></span>
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Details" hint="Tell us what we need to know. Don't paste the harmful content itself.">
        <textarea value={details} maxLength={2000} onChange={(e) => setDetails(e.target.value)} />
      </Field>
      <Field label={chosen?.requiresEmail ? 'Email' : 'Email (optional)'} hint="Used only to contact you about this report.">
        <input type="email" value={email} required={chosen?.requiresEmail ?? false} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      {chosen?.requiresDeclaration ? (
        <>
          <Field label="Your name"><input value={name} required onChange={(e) => setName(e.target.value)} /></Field>
          <label className="consent" style={{ marginLeft: 0 }}>
            <input type="checkbox" checked={onBehalf} onChange={(e) => setOnBehalf(e.target.checked)} />
            <span>I am filing on behalf of the person concerned.</span>
          </label>
          <label className="consent" style={{ marginLeft: 0 }}>
            <input type="checkbox" checked={declaration} onChange={(e) => setDeclaration(e.target.checked)} />
            <span>I declare that this complaint is true, and that I am the person concerned or am acting on their behalf. I understand that false complaints can lead to my reports no longer hiding content automatically.</span>
          </label>
        </>
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button type="submit" className="btn btn-loud" disabled={busy || !target || !category || (chosen?.requiresDeclaration && !declaration)}>{busy ? 'Sending' : 'Send report'}</button>
    </form>
  );
}
