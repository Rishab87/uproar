'use client';
import { useEffect } from 'react';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <main className="claim">
      <div className="claim-card">
        <h1 className="claim-title">That broke</h1>
        <p className="dim">This page failed to load. Your wallet and your posts are not affected.</p>
        <button type="button" className="btn btn-loud" onClick={reset}>Try again</button>
      </div>
    </main>
  );
}
