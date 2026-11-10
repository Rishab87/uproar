import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="claim">
      <div className="claim-card">
        <h1 className="claim-title">Nothing here</h1>
        <p className="dim">This page doesn&apos;t exist.</p>
        <Link prefetch={false} className="btn btn-loud" href="/home">Go to the feed</Link>
      </div>
    </main>
  );
}
