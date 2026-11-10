'use client';
import { LABELS, CATEGORIES } from '@uproar/safety/catalog';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useActions } from '@/lib/client/actions';
import { explorerUrl } from '@/lib/client/config';
import { useApi } from '@/lib/client/data';
import { openCompose, toast, usePostOverlay } from '@/lib/client/stores';
import { useViewer } from '@/lib/client/viewer';
import type { AuthorView, PostView, Preferences, Tombstone } from '@/lib/server/queries';
import { Avatar } from './Avatar';
import { IconBookmark, IconFlag, IconHeart, IconMore, IconPin, IconQuote, IconReply, IconRepost, IconShare, IconWarn } from './icons';
import { Menu } from './Menu';
import { RichText } from './RichText';
import { TimeAgo } from './TimeAgo';

const reasonText = (reason?: string | null) => {
  if (!reason) return null;
  if (reason === 'legal_order') return 'a legal order';
  return CATEGORIES[reason]?.label.toLowerCase() ?? null;
};

export function TombstoneCard({ tombstone, sig, kind = 'post' }: { tombstone: Tombstone; sig?: string; kind?: 'post' | 'profile' }) {
  const noun = kind === 'post' ? 'post' : 'account';
  const appeal = sig ? `/appeal?type=${kind}&target=${encodeURIComponent(sig)}` : '/appeal';
  if (tombstone.kind === 'deleted') return <div className="tombstone">The author deleted this post.</div>;
  const reason = reasonText(tombstone.reason);
  return (
    <div className="tombstone">
      <p>
        {tombstone.kind === 'withheld'
          ? `This ${noun} is withheld in your country (${tombstone.countries?.join(', ')})${reason ? ` because of ${reason}` : ''}.`
          : `This ${noun} is hidden on this app${reason ? `. Reason: ${reason}` : ''}.`}
        {tombstone.note ? ` ${tombstone.note}` : ''}
      </p>
      <p className="tombstone-links">
        <Link prefetch={false} href={appeal}>Appeal this</Link>
        <Link prefetch={false} href="/rules">How decisions are made</Link>
      </p>
    </div>
  );
}

function Who({ author }: { author: AuthorView }) {
  return (
    <span className="who">
      <Link prefetch={false} className="who-name" href={author.handle ? `/@${author.handle}` : '#'} onClick={(e) => e.stopPropagation()}>
        {author.name || (author.handle ? `@${author.handle}` : 'No handle')}
      </Link>
      {author.handle ? <span className="who-handle">@{author.handle}</span> : <span className="who-handle">{author.address.slice(0, 6)}</span>}
    </span>
  );
}

function usePrefs() {
  const { session, profile } = useViewer();
  return useApi<Preferences>(session && profile ? '/api/prefs' : null, { revalidateOnFocus: false }).data;
}

export function QuotedCard({ post }: { post: PostView }) {
  const router = useRouter();
  if (post.tombstone) return <div className="quoted"><TombstoneCard tombstone={post.tombstone} sig={post.sig} /></div>;
  // A plain container, so the links inside it stay real links. The time is the keyboard way in.
  return (
    <div
      className="quoted"
      onClick={(e) => {
        e.stopPropagation();
        router.push(`/post/${post.sig}`);
      }}
    >
      {post.author ? (
        <div className="quoted-head">
          <Avatar author={post.author} size={20} />
          <Who author={post.author} />
          <Link prefetch={false} className="post-time" href={`/post/${post.sig}`} onClick={(e) => e.stopPropagation()}><TimeAgo iso={post.time} /></Link>
        </div>
      ) : null}
      <p className="post-text"><RichText text={post.text ?? ''} /></p>
    </div>
  );
}

export function PostCard({ post, repostedBy, focus, pinned, pending }: { post: PostView; repostedBy?: AuthorView | null; focus?: boolean; pinned?: boolean; pending?: boolean }) {
  const router = useRouter();
  const overlay = usePostOverlay(post.sig);
  const actions = useActions();
  const v = useViewer();
  const prefs = usePrefs();
  const [revealed, setRevealed] = useState(false);

  if (overlay?.deleted) return <article className="post"><TombstoneCard tombstone={{ kind: 'deleted' }} /></article>;
  if (post.tombstone) return <article className="post post-tomb"><TombstoneCard tombstone={post.tombstone} sig={post.sig} /></article>;

  const author = post.author as AuthorView;
  const mine = Boolean(v.profile && v.profile.address === author.address);
  const liked = overlay?.liked ?? post.viewer.liked;
  const reposted = overlay?.reposted ?? post.viewer.reposted;
  const bookmarked = overlay?.bookmarked ?? post.viewer.bookmarked;
  const likes = post.likes + (overlay?.liked !== undefined && overlay.liked !== post.viewer.liked ? (overlay.liked ? 1 : -1) : 0);
  const reposts = post.reposts + (overlay?.reposted !== undefined && overlay.reposted !== post.viewer.reposted ? (overlay.reposted ? 1 : -1) : 0);

  const warned = post.labels.filter((l) => (prefs?.labels[l] ?? LABELS[l]?.defaultAction) === 'warn');
  const gated = warned.length > 0 && !revealed;
  const url = `/post/${post.sig}`;

  const share = async () => {
    const full = `${window.location.origin}${url}`;
    try {
      if (navigator.share) await navigator.share({ url: full });
      else {
        await navigator.clipboard.writeText(full);
        toast('success', 'Link copied.');
      }
    } catch {
      // Closing the share sheet isn't an error.
    }
  };

  return (
    <article
      className={`post${focus ? ' post-focus' : ''}${pending ? ' post-pending' : ''}`}
      onClick={() => {
        if (!focus && !pending) router.push(url);
      }}
    >
      {repostedBy ? (
        <p className="post-context"><IconRepost size={14} /> <Link prefetch={false} href={`/@${repostedBy.handle}`} onClick={(e) => e.stopPropagation()}>{repostedBy.name || `@${repostedBy.handle}`}</Link> reposted</p>
      ) : null}
      {pinned ? <p className="post-context"><IconPin size={14} /> Pinned</p> : null}
      <div className="post-row">
        <Link prefetch={false} href={author.handle ? `/@${author.handle}` : '#'} onClick={(e) => e.stopPropagation()} aria-label={`${author.handle ?? 'author'} profile`} className="post-avatar">
          <Avatar author={author} />
        </Link>
        <div className="post-main">
          <header className="post-head">
            <Who author={author} />
            {pending ? <span className="post-landing">Landing on chain</span> : <Link prefetch={false} className="post-time" href={url} onClick={(e) => e.stopPropagation()}><TimeAgo iso={post.time} /></Link>}
            {!pending ? (
              <Menu label="More" trigger={<IconMore />}>
                {(close) => (
                  <>
                    {mine ? (
                      <>
                        <button role="menuitem" onClick={() => { close(); void actions.pin(post.sig); }}><IconPin size={16} /> Pin to profile</button>
                        <button role="menuitem" className="danger" onClick={() => { close(); if (confirm('Delete this post? Your wallet will ask you to approve it. The post disappears from this app, but the text stays on Solana forever.')) actions.deletePost(post.sig); }}>Delete</button>
                      </>
                    ) : null}
                    <Link prefetch={false} role="menuitem" href={`/report?type=post&target=${encodeURIComponent(post.sig)}`} onClick={close}><IconFlag size={16} /> Report this post</Link>
                    <a role="menuitem" href={explorerUrl(post.sig)} target="_blank" rel="noopener noreferrer" onClick={close}>View on chain</a>
                  </>
                )}
              </Menu>
            ) : null}
          </header>
          {post.replyingTo ? <p className="post-replying">Replying to <Link prefetch={false} href={`/@${post.replyingTo}`} onClick={(e) => e.stopPropagation()}>@{post.replyingTo}</Link></p> : null}
          {gated ? (
            <div className="label-gate">
              <IconWarn size={18} />
              <span>Labelled {warned.map((l) => LABELS[l]?.label.toLowerCase() ?? l).join(', ')}.</span>
              <button type="button" onClick={(e) => { e.stopPropagation(); setRevealed(true); }}>Show</button>
            </div>
          ) : (
            <>
              <p className="post-text"><RichText text={post.text ?? ''} /></p>
              {post.quoted ? <QuotedCard post={post.quoted} /> : null}
            </>
          )}
          {post.labels.length > 0 && !gated ? <p className="post-labels">{post.labels.map((l) => <span key={l} className="tag">{LABELS[l]?.label ?? l}</span>)}</p> : null}
          {!pending ? (
            <footer className="post-actions" onClick={(e) => e.stopPropagation()}>
              <button type="button" className="act" aria-label={`Reply, ${post.replies} replies`} onClick={() => openCompose({ replyTo: post.sig, replyHandle: author.handle })}>
                <IconReply size={18} /> <span>{post.replies || ''}</span>
              </button>
              <button type="button" className={`act act-repost${reposted ? ' on' : ''}`} aria-pressed={reposted} aria-label={`Repost, ${reposts} reposts`} onClick={() => actions.repost(post.sig, !reposted)}>
                <IconRepost size={18} /> <span>{reposts || ''}</span>
              </button>
              <button type="button" className="act" aria-label={`Quote, ${post.quotes} quotes`} onClick={() => openCompose({ quoteOf: post.sig, quoteText: post.text, quoteHandle: author.handle })}>
                <IconQuote size={18} /> <span>{post.quotes || ''}</span>
              </button>
              <button type="button" className={`act act-like${liked ? ' on' : ''}`} aria-pressed={liked} aria-label={`Like, ${likes} likes`} onClick={() => actions.like(post.sig, !liked)}>
                <IconHeart size={18} filled={liked} /> <span>{likes || ''}</span>
              </button>
              <button type="button" className={`act act-mark${bookmarked ? ' on' : ''}`} aria-pressed={bookmarked} aria-label="Bookmark" onClick={() => actions.bookmark(post.sig, !bookmarked)}>
                <IconBookmark size={18} filled={bookmarked} />
              </button>
              <button type="button" className="act" aria-label="Share" onClick={share}>
                <IconShare size={18} />
              </button>
            </footer>
          ) : null}
        </div>
      </div>
    </article>
  );
}
