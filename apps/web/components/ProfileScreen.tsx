'use client';
import { isValidHandle, MAX_BIO_BYTES, MAX_LOCATION_BYTES, MAX_NAME_BYTES, MAX_WEBSITE_BYTES } from '@uproar/protocol';
import Link from 'next/link';
import { useState } from 'react';
import { useActions } from '@/lib/client/actions';
import { useApi, usePaged } from '@/lib/client/data';
import { toast } from '@/lib/client/stores';
import { useViewer } from '@/lib/client/viewer';
import type { FeedItem, Page, ProfilePage, ProfileView } from '@/lib/server/queries';
import { ACCENTS, Avatar } from './Avatar';
import { Field } from './Field';
import { Feed, useInfiniteSentinel } from './Feed';
import { FollowButton } from './FollowButton';
import { IconFlag, IconMore } from './icons';
import { Menu } from './Menu';
import { Modal } from './Modal';
import { PostCard, TombstoneCard } from './PostCard';
import { PersonRow } from './Sidebar';
import { SignBanner } from './SignBanner';
import { BackHead } from './ThreadScreen';
import { signShareHref } from '@/lib/client/share';

const bytes = (s: string) => new TextEncoder().encode(s).length;

function EditProfile({ profile, onClose }: { profile: ProfileView; onClose: () => void }) {
  const actions = useActions();
  const [name, setName] = useState(profile.name);
  const [bio, setBio] = useState(profile.bio);
  const [website, setWebsite] = useState(profile.website);
  const [location, setLocation] = useState(profile.location);
  const [accent, setAccent] = useState(profile.accent);
  const [avatarSeed, setSeed] = useState(profile.avatarSeed);
  const [busy, setBusy] = useState(false);
  const over = bytes(name) > MAX_NAME_BYTES || bytes(bio) > MAX_BIO_BYTES || bytes(website) > MAX_WEBSITE_BYTES || bytes(location) > MAX_LOCATION_BYTES;
  const badWebsite = website.trim() !== '' && !/^https?:\/\//.test(website.trim());
  return (
    <Modal title="Edit profile" onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (over || badWebsite) return;
          setBusy(true);
          const ok = await actions.setProfile({ name: name.trim(), bio: bio.trim(), website: website.trim(), location: location.trim(), avatarSeed, accent });
          setBusy(false);
          if (ok) {
            toast('success', 'Profile updated.');
            onClose();
          }
        }}
      >
        <div className="setting-row">
          <Avatar author={{ address: profile.address, avatarSeed, accent }} size={64} />
          <div className="chips">
            <button type="button" className="btn" onClick={() => setSeed((avatarSeed + 1) % 65_535)}>New pattern</button>
            {ACCENTS.map((c, i) => (
              <button key={c} type="button" aria-label={`Colour ${i + 1}`} aria-pressed={accent === i} onClick={() => setAccent(i)} style={{ width: 40, height: 40, background: c, outline: accent === i ? '2px solid #f1f3f7' : 'none', outlineOffset: 2 }} />
            ))}
          </div>
        </div>
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={MAX_NAME_BYTES} /></Field>
        <Field label="Bio" hint={`${bytes(bio)} of ${MAX_BIO_BYTES} bytes`}><textarea value={bio} onChange={(e) => setBio(e.target.value)} /></Field>
        <Field label="Website" error={badWebsite ? 'Start the address with https://' : null}><input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" inputMode="url" /></Field>
        <Field label="Location"><input value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
        <p className="dim small">Your profile is written to Solana. Old versions stay on the chain.</p>
        <button type="submit" className="btn btn-loud" disabled={busy || over || badWebsite}>{busy ? 'Saving' : 'Save profile'}</button>
      </form>
    </Modal>
  );
}

function FollowList({ handle, side, onClose }: { handle: string; side: 'followers' | 'following'; onClose: () => void }) {
  const { items, hasMore, loading, loadMore } = usePaged<ProfileView>(`/api/profile/${handle}/follows?side=${side}`);
  const sentinel = useInfiniteSentinel(hasMore && !loading, loadMore);
  return (
    <Modal title={side === 'followers' ? 'Followers' : 'Following'} onClose={onClose}>
      <div className="person-list">
        {items.map((p) => <PersonRow key={p.address} person={p} />)}
        {!loading && items.length === 0 ? <p className="dim">Nobody yet.</p> : null}
        {hasMore ? <div ref={sentinel} /> : null}
      </div>
    </Modal>
  );
}

const TABS = [
  { key: 'posts', label: 'Posts' },
  { key: 'replies', label: 'Replies' },
  { key: 'likes', label: 'Likes' },
] as const;

export function ProfileScreen({ handle, initial, initialFeed }: { handle: string; initial: ProfilePage; initialFeed: Page<FeedItem> }) {
  const { data, mutate } = useApi<ProfilePage>(`/api/profile/${handle}`, { fallbackData: initial });
  const page = data ?? initial;
  const v = useViewer();
  const [tab, setTab] = useState<'posts' | 'replies' | 'likes'>('posts');
  const [editing, setEditing] = useState(false);
  const [list, setList] = useState<'followers' | 'following' | null>(null);
  const { profile, tombstone, pinned, viewer } = page;
  const mine = v.profile?.address === profile.address;

  const pref = async (op: string, message: string) => {
    if (!v.session) {
      toast('error', 'Start a session to use this. It keeps your block and mute lists private.', { label: 'Open settings', href: '/settings' });
      return;
    }
    try {
      const res = await v.signedFetch('/api/prefs', { method: 'POST', body: { op, target: profile.address } });
      if (res.ok) {
        toast('success', message);
        void mutate();
      } else toast('error', 'That did not save. Try again.');
    } catch {
      toast('error', 'Could not reach the server. Check your connection and try again.');
    }
  };

  const subtitle = tombstone ? undefined : `${profile.posts} ${profile.posts === 1 ? 'post' : 'posts'}`;
  return (
    <>
      <BackHead title={profile.name || `@${handle}`} subtitle={subtitle} />
      <SignBannerFor handle={handle} accent={profile.accent} />
      {tombstone ? (
        <div className="profile-head"><p className="profile-name">@{handle}</p><div style={{ marginTop: 12 }}><TombstoneCard tombstone={tombstone} sig={profile.address} kind="profile" /></div></div>
      ) : (
        <>
          <section className="profile-head">
            <div className="profile-top">
              <Avatar author={profile} size={92} />
              <div className="profile-actions">
                {mine ? (
                  <>
                    <a className="btn" href={signShareHref(handle)} target="_blank" rel="noopener noreferrer">Share my sign</a>
                    <button type="button" className="btn" onClick={() => setEditing(true)}>Edit profile</button>
                  </>
                ) : (
                  <>
                    <Menu label="More" trigger={<IconMore />}>
                      {(close) => (
                        <>
                          <button role="menuitem" onClick={() => { close(); void pref(viewer.muted ? 'unmute' : 'mute', viewer.muted ? 'Unmuted.' : `Muted @${handle}. Only you can see this.`); }}>{viewer.muted ? 'Unmute' : 'Mute'} @{handle}</button>
                          <button role="menuitem" onClick={() => { close(); void pref(viewer.blocked ? 'unblock' : 'block', viewer.blocked ? 'Unblocked.' : `Blocked @${handle}. You won't see each other's activity here.`); }}>{viewer.blocked ? 'Unblock' : 'Block'} @{handle}</button>
                          <Link prefetch={false} role="menuitem" href={`/report?type=profile&target=${encodeURIComponent(profile.address)}`} onClick={close}><IconFlag size={16} /> Report this account</Link>
                        </>
                      )}
                    </Menu>
                    {v.account ? <FollowButton key={String(viewer.following)} target={profile.address} following={viewer.following} /> : <button type="button" className="btn btn-cyan" onClick={v.openConnect}>Follow</button>}
                  </>
                )}
              </div>
            </div>
            <h2 className="profile-name">{profile.name || handle}</h2>
            <p className="profile-handle">@{handle}{viewer.followsYou ? <span className="follows-you">Follows you</span> : null}</p>
            {profile.bio ? <p className="profile-bio">{profile.bio}</p> : null}
            <div className="profile-meta">
              {profile.location ? <span>{profile.location}</span> : null}
              {/^https?:\/\//.test(profile.website) ? <a href={profile.website} target="_blank" rel="nofollow ugc noopener noreferrer">{profile.website.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40)}</a> : null}
              {profile.createdAt ? <span>On chain since {new Date(profile.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span> : null}
            </div>
            <div className="profile-counts">
              <button type="button" onClick={() => setList('following')}><strong>{profile.following}</strong> Following</button>
              <button type="button" onClick={() => setList('followers')}><strong>{profile.followers}</strong> {profile.followers === 1 ? 'Follower' : 'Followers'}</button>
            </div>
          </section>
          <div className="tabs" role="tablist">
            {TABS.map((t) => <button key={t.key} type="button" role="tab" className="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}>{t.label}</button>)}
          </div>
          {tab === 'posts' && pinned ? <PostCard post={pinned} pinned /> : null}
          <Feed key={tab} path={`/api/profile/${handle}/feed?tab=${tab}`} initial={tab === 'posts' ? initialFeed : undefined} empty={<p>{tab === 'posts' ? 'No posts yet.' : tab === 'replies' ? 'No replies yet.' : 'No likes yet.'}</p>} />
        </>
      )}
      {editing ? <EditProfile profile={profile} onClose={() => setEditing(false)} /> : null}
      {list ? <FollowList handle={handle} side={list} onClose={() => setList(null)} /> : null}
    </>
  );
}

function SignBannerFor({ handle, accent }: { handle: string; accent: number }) {
  return <SignBanner handle={handle} accent={accent} />;
}

export function UnclaimedProfile({ handle }: { handle: string }) {
  const valid = isValidHandle(handle.toLowerCase());
  return (
    <>
      <BackHead title={`@${handle}`} />
      <div className="feed-empty">
        <h2>{valid ? 'Nobody has this name' : 'Not a valid name'}</h2>
        {valid ? <><p>@{handle.toLowerCase()} is free to claim, unless someone claimed it in the last few seconds.</p><Link prefetch={false} className="btn btn-loud" href={`/claim?h=${encodeURIComponent(handle.toLowerCase())}`}>Claim @{handle.toLowerCase()}</Link></> : <p>Names are 3 to 15 characters of a to z, 0 to 9 and underscore.</p>}
      </div>
    </>
  );
}
