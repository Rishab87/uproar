'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useViewer } from '@/lib/client/viewer';
import type { FeedItem, Page } from '@/lib/server/queries';
import { Composer } from './Composer';
import { Feed } from './Feed';

type Tab = 'foryou' | 'following' | 'latest';
const TABS: { key: Tab; label: string }[] = [
  { key: 'foryou', label: 'For you' },
  { key: 'following', label: 'Following' },
  { key: 'latest', label: 'Latest' },
];

export function HomeScreen({ initial }: { initial: Page<FeedItem> }) {
  const [tab, setTab] = useState<Tab>('foryou');
  const v = useViewer();
  return (
    <>
      <header className="screen-head">
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" className="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>
      </header>
      <Composer />
      <Feed
        key={tab}
        path={`/api/feed?tab=${tab}`}
        initial={tab === 'foryou' ? initial : undefined}
        showPending
        refreshMs={20_000}
        empty={
          tab === 'following' && v.account ? (
            <>
              <h2>Nobody here yet</h2>
              <p>Follow people and their posts land here, newest first, with nothing ranked.</p>
              <Link prefetch={false} className="btn" href="/explore">Find people</Link>
            </>
          ) : tab === 'following' ? (
            <>
              <h2>Your people</h2>
              <p>Connect a wallet to see posts from people you follow.</p>
              <button type="button" className="btn btn-loud" onClick={v.openConnect}>Connect wallet</button>
            </>
          ) : (
            <>
              <h2>Be first</h2>
              <p>Nothing has been posted yet. Claim a name and say something.</p>
              <Link prefetch={false} className="btn btn-loud" href="/claim">Claim your name</Link>
            </>
          )
        }
      />
    </>
  );
}
