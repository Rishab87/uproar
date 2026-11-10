'use client';
import { useState, type FormEvent } from 'react';
import { Field } from './Field';

function useSubmit(url: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ ref: string; dueAt: string } | null>(null);
  const submit = async (e: FormEvent<HTMLFormElement>, build: (d: FormData) => unknown) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(build(new FormData(e.currentTarget))) });
      const body = (await res.json()) as { ref: string; dueAt: string; error?: string };
      if (!res.ok) setError(body.error ?? 'The submission did not go through. Try again.');
      else setDone(body);
    } catch {
      setError('The submission did not go through. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, done, submit };
}

const str = (d: FormData, k: string) => String(d.get(k) ?? '').trim();

export function parseTargets(text: string): { type: 'post' | 'profile'; target: string }[] {
  return text
    .split(/[\s,]+/)
    .map((v) => v.trim())
    .filter(Boolean)
    .flatMap((v): { type: 'post' | 'profile'; target: string }[] => {
      const post = v.match(/\/post\/([1-9A-HJ-NP-Za-km-z]{64,90})/);
      if (post?.[1]) return [{ type: 'post', target: post[1] }];
      if (/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(v)) return [{ type: 'post', target: v }];
      if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) return [{ type: 'profile', target: v }];
      return [];
    });
}

export function OrderForm() {
  const { busy, error, done, submit } = useSubmit('/api/legal/order');
  if (done) return <div className="result" data-testid="order-filed"><strong>Order received: {done.ref}</strong><p>Received now. The 3-hour clock ends at {new Date(done.dueAt).toLocaleString()}. We verify the order, then act on it and reply to the contact email.</p></div>;
  return (
    <form
      className="form"
      onSubmit={(e) =>
        submit(e, (d) => ({
          kind: str(d, 'kind'),
          authority: str(d, 'authority'),
          officerName: str(d, 'officerName'),
          officerDesignation: str(d, 'officerDesignation'),
          orderReference: str(d, 'orderReference'),
          contactEmail: str(d, 'contactEmail'),
          documentUrl: str(d, 'documentUrl'),
          targets: parseTargets(str(d, 'targets')),
          scopeCountries: str(d, 'countries').split(/[\s,]+/).filter(Boolean),
          details: str(d, 'details'),
        }))
      }
    >
      <Field label="Type of order"><select name="kind" defaultValue="court"><option value="court">Court order</option><option value="government">Government notification, Section 79(3)(b)</option><option value="police">Police intimation</option></select></Field>
      <Field label="Issuing court or agency"><input name="authority" required /></Field>
      <Field label="Officer name"><input name="officerName" required /></Field>
      <Field label="Officer designation and rank" hint="Police intimations must come from an officer not below Deputy Inspector General, specially authorised in writing."><input name="officerDesignation" required /></Field>
      <Field label="Order reference number"><input name="orderReference" required /></Field>
      <Field label="Official contact email"><input type="email" name="contactEmail" required /></Field>
      <Field label="Link to the signed order"><input type="url" name="documentUrl" placeholder="https://" /></Field>
      <Field label="Posts or accounts named in the order" hint="Post links or account addresses, separated by spaces or new lines."><textarea name="targets" required /></Field>
      <Field label="Countries the order applies to" hint="Two-letter codes. Leave empty only if the order applies worldwide."><input name="countries" placeholder="IN" /></Field>
      <Field label="Anything else"><textarea name="details" /></Field>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button type="submit" className="btn btn-loud" disabled={busy}>{busy ? 'Sending' : 'Submit order'}</button>
    </form>
  );
}

export function DataRequestForm() {
  const { busy, error, done, submit } = useSubmit('/api/legal/data-request');
  if (done) return <div className="result" data-testid="data-filed"><strong>Request received: {done.ref}</strong><p>We verify the request and respond by {new Date(done.dueAt).toLocaleString()}.</p></div>;
  return (
    <form
      className="form"
      onSubmit={(e) =>
        submit(e, (d) => ({
          authority: str(d, 'authority'),
          officerName: str(d, 'officerName'),
          officerDesignation: str(d, 'officerDesignation'),
          legalBasis: str(d, 'legalBasis'),
          contactEmail: str(d, 'contactEmail'),
          subject: str(d, 'subject'),
          details: str(d, 'details'),
        }))
      }
    >
      <Field label="Requesting agency"><input name="authority" required /></Field>
      <Field label="Officer name"><input name="officerName" required /></Field>
      <Field label="Officer designation"><input name="officerDesignation" required /></Field>
      <Field label="Legal basis and order reference"><input name="legalBasis" required /></Field>
      <Field label="Official contact email"><input type="email" name="contactEmail" required /></Field>
      <Field label="Which account, wallet or post is this about?"><input name="subject" required /></Field>
      <Field label="What information do you need?"><textarea name="details" /></Field>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button type="submit" className="btn" disabled={busy}>{busy ? 'Sending' : 'Submit request'}</button>
    </form>
  );
}
