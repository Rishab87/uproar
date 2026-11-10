'use client';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { usePaged } from '@/lib/client/data';
import { removePending, usePending } from '@/lib/client/stores';
import { useViewer } from '@/lib/client/viewer';
import type { FeedItem, Page, PostView } from '@/lib/server/queries';
import { PostCard } from './PostCard';

export function pendingAsView(p: { sig: string; text: string; at: number; replyTo: string | null }, author: PostView['author']): PostView {
  return {
    sig: p.sig,
    author,
    text: p.text,
    tombstone: null,
    replyTo: p.replyTo,
    replyingTo: null,
    quoteOf: null,
    quoted: null,
    slot: 0,
    time: new Date(p.at).toISOString(),
    likes: 0,
    reposts: 0,
    replies: 0,
    quotes: 0,
    labels: [],
    viewer: { liked: false, reposted: false, bookmarked: false },
  };
}

export function useInfiniteSentinel(enabled: boolean, onHit: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting) onHit();
    }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [enabled, onHit]);
  return ref;
}

export function Feed({ path, initial, empty, showPending, refreshMs }: { path: string | null; initial?: Page<FeedItem> | undefined; empty: ReactNode; showPending?: boolean; refreshMs?: number }) {
  const { items, hasMore, loading, error, loadMore } = usePaged<FeedItem>(path, { initial, ...(refreshMs ? { refreshMs } : {}) });
  const v = useViewer();
  const pending = usePending();
  const sentinel = useInfiniteSentinel(hasMore && !loading, loadMore);

  const known = useMemo(() => new Set(items.map((i) => i.post.sig)), [items]);
  useEffect(() => {
    for (const p of pending) if (known.has(p.sig)) removePending(p.sig);
  }, [known, pending]);

  const mine = showPending ? pending.filter((p) => !p.replyTo && !known.has(p.sig)) : [];

  return (
    <div className="feed">
      {mine.map((p) => <PostCard key={p.sig} post={pendingAsView(p, v.profile)} pending />)}
      {items.map((item) => <PostCard key={`${item.post.sig}:${item.repostedBy?.address ?? ''}`} post={item.post} repostedBy={item.repostedBy} />)}
      {error && items.length === 0 ? <p className="feed-note">Could not load this. Check your connection and refresh.</p> : null}
      {!error && !loading && items.length === 0 && mine.length === 0 ? <div className="feed-empty">{empty}</div> : null}
      {loading && items.length === 0 ? <p className="feed-note">Loading</p> : null}
      {hasMore ? <div ref={sentinel} className="feed-more"><button type="button" className="btn" onClick={loadMore}>Show more</button></div> : null}
    </div>
  );
}
