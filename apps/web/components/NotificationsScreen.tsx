'use client';
import Link from 'next/link';
import { useEffect } from 'react';
import { usePaged } from '@/lib/client/data';
import { useViewer } from '@/lib/client/viewer';
import type { NotificationView, PostView } from '@/lib/server/queries';
import { Avatar } from './Avatar';
import { useInfiniteSentinel } from './Feed';
import { IconHeart, IconReply, IconRepost, IconUser } from './icons';
import { PostCard } from './PostCard';
import { RichText } from './RichText';
import { LAST_SEEN_KEY } from './Shell';
import { TimeAgo } from './TimeAgo';
import { BackHead } from './ThreadScreen';

const VERB: Record<NotificationView['kind'], string> = {
  like: 'liked your post',
  repost: 'reposted your post',
  reply: 'replied',
  quote: 'quoted your post',
  follow: 'followed you',
  mention: 'mentioned you',
};

function Row({ n }: { n: NotificationView }) {
  if (n.post && (n.kind === 'reply' || n.kind === 'quote' || n.kind === 'mention')) return <PostCard post={n.post} />;
  const Icon = n.kind === 'like' ? IconHeart : n.kind === 'repost' ? IconRepost : n.kind === 'follow' ? IconUser : IconReply;
  const color = n.kind === 'like' ? 'var(--neon)' : n.kind === 'repost' ? 'var(--cyan)' : 'var(--white)';
  const post = n.post as PostView | null;
  const body = (
    <div className="post-row">
      <span style={{ color, width: 44, display: 'flex', justifyContent: 'center' }}><Icon size={22} filled={n.kind === 'like'} /></span>
      <div className="post-main">
        <Avatar author={n.actor} size={32} />
        <p style={{ marginTop: 6 }}><strong>{n.actor.name || `@${n.actor.handle}`}</strong> {VERB[n.kind]}</p>
        {post?.text ? <p className="dim post-text"><RichText text={post.text} /></p> : null}
        {post?.time ? <p className="small dim"><TimeAgo iso={post.time} /></p> : null}
      </div>
    </div>
  );
  return <article className="post" style={{ paddingBottom: 13 }}><Link prefetch={false} href={post ? `/post/${post.sig}` : `/@${n.actor.handle}`}>{body}</Link></article>;
}

export function NotificationsScreen() {
  const v = useViewer();
  const { items, hasMore, loading, loadMore, error } = usePaged<NotificationView>(v.session && v.profile ? '/api/notifications' : null, { refreshMs: 20_000 });
  const sentinel = useInfiniteSentinel(hasMore && !loading, loadMore);

  useEffect(() => {
    const newest = items[0]?.slot;
    if (newest) localStorage.setItem(LAST_SEEN_KEY, String(newest));
  }, [items]);

  return (
    <>
      <BackHead title="Notifications" />
      {!v.account ? (
        <div className="feed-empty"><h2>Connect first</h2><p>Likes, replies and follows on your posts show up here.</p><button type="button" className="btn btn-loud" onClick={v.openConnect}>Connect wallet</button></div>
      ) : !v.session ? (
        <div className="feed-empty"><h2>Start a session</h2><p>A session key lets this app load your notifications without a wallet popup each time.</p><Link prefetch={false} className="btn btn-loud" href="/settings#session">Start a session</Link></div>
      ) : (
        <>
          {items.map((n) => <Row key={n.id} n={n} />)}
          {error ? <p className="feed-note">Could not load notifications. Check your connection and refresh.</p> : null}
          {!loading && !error && items.length === 0 ? <div className="feed-empty"><h2>Quiet so far</h2><p>Post something and it won&apos;t stay this way.</p></div> : null}
          {hasMore ? <div ref={sentinel} className="feed-more"><button type="button" className="btn" onClick={loadMore}>Show more</button></div> : null}
        </>
      )}
    </>
  );
}
