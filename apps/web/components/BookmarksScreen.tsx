'use client';
import Link from 'next/link';
import { useViewer } from '@/lib/client/viewer';
import { Feed } from './Feed';
import { BackHead } from './ThreadScreen';

export function BookmarksScreen() {
  const v = useViewer();
  return (
    <>
      <BackHead title="Bookmarks" subtitle="Private to you. They never go on chain." />
      {!v.account ? (
        <div className="feed-empty"><h2>Connect first</h2><button type="button" className="btn btn-loud" onClick={v.openConnect}>Connect wallet</button></div>
      ) : !v.session ? (
        <div className="feed-empty"><h2>Start a session</h2><p>Bookmarks need a session key, so only you can read them.</p><Link prefetch={false} className="btn btn-loud" href="/settings#session">Start a session</Link></div>
      ) : (
        <Feed path="/api/bookmarks" empty={<><h2>Nothing saved</h2><p>Tap the bookmark on any post to keep it here.</p></>} />
      )}
    </>
  );
}
