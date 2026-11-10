'use client';
import { MAX_WEIGHTED_LENGTH, weightedLength } from '@uproar/protocol';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { useActions } from '@/lib/client/actions';
import { useViewer } from '@/lib/client/viewer';
import { CONSENT_VERSION } from '@/lib/shared/auth';
import { Avatar } from './Avatar';

const consentKey = (profile: string) => `uproar.consent.${CONSENT_VERSION}.${profile}`;

export function Composer({
  replyTo,
  replyHandle,
  quoteOf,
  autoFocus,
  onPosted,
  placeholder,
}: {
  replyTo?: string | undefined;
  replyHandle?: string | null | undefined;
  quoteOf?: string | undefined;
  autoFocus?: boolean;
  onPosted?: () => void;
  placeholder?: string;
}) {
  const v = useViewer();
  const actions = useActions();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [needsConsent, setNeedsConsent] = useState(false);
  const [consented, setConsented] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const textId = useId();

  useEffect(() => {
    if (v.profile) setNeedsConsent(localStorage.getItem(consentKey(v.profile.address)) === null);
  }, [v.profile]);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  if (!v.ready) return null;
  if (!v.account || (!v.profile?.handle && !v.pendingProfile?.handle)) {
    return (
      <div className="composer-empty">
        <p>{v.account ? 'Claim a name to start posting.' : 'Connect a wallet to post, reply and follow. Reading never needs one.'}</p>
        {v.account ? <Link prefetch={false} className="btn btn-loud" href="/claim">Claim your name</Link> : <button type="button" className="btn btn-loud" onClick={v.openConnect}>Connect wallet</button>}
      </div>
    );
  }

  const weight = weightedLength(text);
  const left = MAX_WEIGHTED_LENGTH - weight;
  const empty = text.trim().length === 0;
  const blocked = busy || empty || left < 0 || (needsConsent && !consented);

  const submit = async () => {
    if (blocked) return;
    // Consent is recorded before anything is written to the chain, since that is what it covers.
    if (needsConsent && v.profile) {
      localStorage.setItem(consentKey(v.profile.address), new Date().toISOString());
      setNeedsConsent(false);
      void v.signedFetch('/api/consent', { method: 'POST', body: {} }).catch(() => {});
    }
    setBusy(true);
    const previous = text;
    setText('');
    const ok = await actions.post({ text: previous, replyTo: replyTo ?? null, quoteOf: quoteOf ?? null });
    setBusy(false);
    if (!ok) {
      setText(previous);
      return;
    }
    onPosted?.();
  };

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="composer-row">
        <Avatar author={v.profile} />
        <div className="composer-main">
          {replyHandle ? <p className="post-replying">Replying to @{replyHandle}</p> : null}
          <label className="visually-hidden" htmlFor={textId}>Post text</label>
          <textarea
            id={textId}
            ref={area}
            rows={2}
            value={text}
            autoFocus={autoFocus}
            placeholder={placeholder ?? (replyTo ? 'Post your reply' : quoteOf ? 'Add your take' : 'Say it')}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void submit();
            }}
          />
        </div>
      </div>
      {needsConsent ? (
        <label className="consent">
          <input type="checkbox" checked={consented} onChange={(e) => setConsented(e.target.checked)} />
          <span>
            I am 18 or older and I accept the <Link prefetch={false} href="/terms" target="_blank">Terms</Link> and <Link prefetch={false} href="/rules" target="_blank">Rules</Link>. My posts are written to Solana. Deleting one hides it here, but nobody can erase it from the chain.
          </span>
        </label>
      ) : null}
      <div className="composer-foot">
        <span className={`meter${left < 0 ? ' meter-over' : left <= 20 ? ' meter-near' : ''}`} aria-live="polite" aria-label={`${left} characters left`}>
          <span className="meter-bar"><span style={{ width: `${Math.min(100, (weight / MAX_WEIGHTED_LENGTH) * 100)}%` }} /></span>
          {left <= 40 ? <span className="meter-num">{left}</span> : null}
        </span>
        <button type="submit" className="btn btn-loud" disabled={blocked}>{busy ? 'Posting' : replyTo ? 'Reply' : 'Post'}</button>
      </div>
    </form>
  );
}
