'use client';
import Link from 'next/link';
import { dismissToast, useToasts } from '@/lib/client/stores';

export function Toasts() {
  const toasts = useToasts();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <span>{t.text}</span>
          {t.action ? <Link prefetch={false} href={t.action.href} onClick={() => dismissToast(t.id)}>{t.action.label}</Link> : null}
          <button type="button" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
