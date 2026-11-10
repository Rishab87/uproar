'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useApi } from '@/lib/client/data';
import { removePending, usePending } from '@/lib/client/stores';
import { useViewer } from '@/lib/client/viewer';
import type { Thread } from '@/lib/server/queries';
import { Composer } from './Composer';
import { pendingAsView } from './Feed';
import { IconBack } from './icons';
import { PostCard } from './PostCard';

export function BackHead({ title, subtitle }: { title: string; subtitle?: string | undefined }) {
  const router = useRouter();
  return (
    <header className="screen-head">
      <div className="screen-title">
        <button type="button" className="icon-btn" aria-label="Back" onClick={() => router.back()}><IconBack /></button>
        <div>
          <h1 className={title.startsWith('@') ? 'as-handle' : undefined}>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
      </div>
    </header>
  );
}

export function ThreadScreen({ sig, initial }: { sig: string; initial: Thread | null }) {
  const { data, error } = useApi<Thread>(`/api/post/${sig}`, {
    ...(initial ? { fallbackData: initial } : {}),
    refreshInterval: initial ? 20_000 : 2_000,
    shouldRetryOnError: true,
    errorRetryInterval: 2_500,
  });
  const v = useViewer();
  const pending = usePending();
  const thread = data ?? initial;

  // A link can arrive before the indexer has seen the post, so tell the indexer about it.
  useEffect(() => {
    if (thread) return;
    void fetch('/api/ingest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signature: sig }) }).catch(() => {});
  }, [thread, sig]);

  const known = new Set(thread?.replies.map((r) => r.sig) ?? []);
  useEffect(() => {
    for (const p of pending) if (known.has(p.sig)) removePending(p.sig);
  });

  if (!thread) {
    return (
      <>
        <BackHead title="Post" />
        <div className="feed-empty">
          {error ? (
            <>
              <h2>Not found</h2>
              <p>This post isn&apos;t on the chain, or it hasn&apos;t reached this app yet.</p>
              <Link prefetch={false} className="btn" href="/home">Back to the feed</Link>
            </>
          ) : (
            <p>Looking for this post on the chain.</p>
          )}
        </div>
      </>
    );
  }

  const mine = pending.filter((p) => p.replyTo === sig && !known.has(p.sig));
  return (
    <>
      <BackHead title="Post" />
      {thread.ancestors.map((a) => <PostCard key={a.sig} post={a} />)}
      <PostCard post={thread.post} focus />
      {thread.post.tombstone ? null : <Composer replyTo={sig} replyHandle={thread.post.author?.handle} />}
      {mine.map((p) => <PostCard key={p.sig} post={pendingAsView(p, v.profile)} pending />)}
      {thread.replies.map((r) => <PostCard key={r.sig} post={r} />)}
    </>
  );
}
