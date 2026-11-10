'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useApi } from '@/lib/client/data';
import type { ProfileView } from '@/lib/server/queries';
import { Avatar } from './Avatar';
import { FollowButton } from './FollowButton';
import { IconSearch } from './icons';

export function SearchBox({ initial = '' }: { initial?: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);
  return (
    <form
      role="search"
      className="search"
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim()) router.push(`/explore?q=${encodeURIComponent(q.trim())}`);
      }}
    >
      <IconSearch size={18} />
      <label className="visually-hidden" htmlFor="search-box">Search</label>
      <input id="search-box" type="search" value={q} placeholder="Search posts and people" onChange={(e) => setQ(e.target.value)} />
    </form>
  );
}

export function Trends() {
  const { data } = useApi<{ tag: string; posts: number }[]>('/api/trends', { refreshInterval: 120_000 });
  if (!data?.length) return null;
  return (
    <section className="panel">
      <h2>Trending</h2>
      <ol className="trend-list">
        {data.map((t) => (
          <li key={t.tag}>
            <Link prefetch={false} href={`/tag/${encodeURIComponent(t.tag)}`}>
              <strong>#{t.tag}</strong>
              <span>{t.posts} {t.posts === 1 ? 'post' : 'posts'}</span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function PersonRow({ person }: { person: ProfileView }) {
  return (
    <div className="person">
      <Link prefetch={false} href={`/@${person.handle}`} className="person-link">
        <Avatar author={person} size={40} />
        <span className="person-text">
          <strong>{person.name || `@${person.handle}`}</strong>
          <span>@{person.handle}</span>
        </span>
      </Link>
      <FollowButton target={person.address} />
    </div>
  );
}

export function WhoToFollow() {
  const { data } = useApi<ProfileView[]>('/api/who-to-follow', { revalidateOnFocus: false });
  if (!data?.length) return null;
  return (
    <section className="panel">
      <h2>Who to follow</h2>
      <div className="people">
        {data.map((p) => <PersonRow key={p.address} person={p} />)}
      </div>
    </section>
  );
}

export function FooterLinks() {
  return (
    <nav className="foot-links" aria-label="Legal">
      <Link prefetch={false} href="/rules">Rules</Link>
      <Link prefetch={false} href="/terms">Terms</Link>
      <Link prefetch={false} href="/privacy">Privacy</Link>
      <Link prefetch={false} href="/grievance">Grievance Officer</Link>
      <Link prefetch={false} href="/report">Report</Link>
      <Link prefetch={false} href="/law-enforcement">Law enforcement</Link>
      <Link prefetch={false} href="/transparency">Transparency</Link>
      <Link prefetch={false} href="/algorithm">How For You works</Link>
      <Link prefetch={false} href="/protocol">Run your own</Link>
    </nav>
  );
}

export function Sidebar() {
  return (
    <div className="side">
      <SearchBox />
      <Trends />
      <WhoToFollow />
      <FooterLinks />
    </div>
  );
}
