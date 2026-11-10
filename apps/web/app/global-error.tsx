'use client';

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ background: '#05070c', color: '#f1f3f7', fontFamily: 'system-ui', padding: 32 }}>
        <h1>That broke</h1>
        <p>This page failed to load. Your wallet and your posts are not affected.</p>
        <button type="button" onClick={reset} style={{ padding: '10px 16px', background: '#ff2d95', color: '#05070c', border: 0, fontWeight: 700 }}>Try again</button>
      </body>
    </html>
  );
}
