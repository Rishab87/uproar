'use client';
import { useState } from 'react';
import { usePaged } from '@/lib/client/data';
import type { FeedItem, ProfileView } from '@/lib/server/queries';
import { Feed, useInfiniteSentinel } from './Feed';
import { PersonRow, SearchBox, Trends, WhoToFollow } from './Sidebar';

function People({ q }: { q: string }) {
  const { items, hasMore, loading, loadMore } = usePaged<ProfileView>(`/api/search?type=people&q=${encodeURIComponent(q)}`);
  const sentinel = useInfiniteSentinel(hasMore && !loading, loadMore);
  return (
    <div className="person-list">
      {items.map((p) => <PersonRow key={p.address} person={p} />)}
      {!loading && items.length === 0 ? <div className="feed-empty"><p>Nobody matches &ldquo;{q}&rdquo;.</p></div> : null}
      {hasMore ? <div ref={sentinel} /> : null}
    </div>
  );
}

export function ExploreScreen({ q }: { q: string }) {
  const [tab, setTab] = useState<'posts' | 'people'>('posts');
  return (
    <>
      <header className="screen-head">
        <div style={{ padding: '10px 16px' }}><SearchBox key={q} initial={q} /></div>
        {q ? (
          <div className="tabs" role="tablist">
            <button type="button" role="tab" className="tab" aria-selected={tab === 'posts'} onClick={() => setTab('posts')}>Posts</button>
            <button type="button" role="tab" className="tab" aria-selected={tab === 'people'} onClick={() => setTab('people')}>People</button>
          </div>
        ) : null}
      </header>
      {q ? (
        tab === 'posts' ? <Feed key={q} path={`/api/search?q=${encodeURIComponent(q)}`} empty={<p>No posts match &ldquo;{q}&rdquo;.</p>} /> : <People key={q} q={q} />
      ) : (
        <div className="side" style={{ padding: 16 }}>
          <Trends />
          <WhoToFollow />
          <section className="panel"><h2>Latest</h2></section>
          <div style={{ margin: '-14px -16px 0' }}><Feed path="/api/feed?tab=latest" empty={<p>Nothing has been posted yet.</p>} /></div>
        </div>
      )}
    </>
  );
}
export type { FeedItem };
