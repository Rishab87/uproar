'use client';
import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { CLUSTER, IS_MAINNET } from '@/lib/client/config';
import { useViewer } from '@/lib/client/viewer';
import { CityHero } from './CityHero';
import { ConnectOnly } from './ConnectOnly';
import { FooterLinks } from './Sidebar';
import { TornEdge } from './TornEdge';

const TRUTHS = [
  { title: 'Your name is yours', text: 'It lives on Solana under your wallet, not in our database. Release it and your deposit comes back.' },
  { title: 'Posts stay on the chain', text: 'Nobody can edit or erase them, us included. Deleting one hides it in this app and any other app that respects deletes.' },
  { title: 'This app follows the law', text: 'Illegal posts get hidden here, with a public record of what we did and a way to appeal. The rules are published.' },
  { title: 'You choose what you see', text: 'Mute, block and filter by label. The For You formula is published, with no manual picks and no paid boosts.' },
  { title: 'Anyone can build another', text: 'The protocol is open. If you disagree with this app, run your own and read the same chain.' },
  { title: 'No token. No ads.', text: 'There is nothing to buy and no fee to us. You pay network costs, and your deposit and rent come back.' },
];

export function Landing({ handles, stats }: { handles: { handle: string; accent: number }[]; stats: { handles: number; posts: number } }) {
  const v = useViewer();
  const router = useRouter();
  const claimed = Boolean(v.profile?.handle);

  useEffect(() => {
    if (claimed) router.prefetch('/home');
  }, [claimed, router]);

  const cta = claimed ? { href: '/home', label: 'Open the feed' } : { href: '/claim', label: 'Claim your name' };

  return (
    <div className="landing">
      <div className="landing-still" />
      <CityHero handles={handles} />
      <header className="landing-bar">
        <span />
        <nav className="landing-nav" aria-label="Main">
          <Link prefetch={false} className="btn" href="/home">Read the feed</Link>
          {v.account ? null : <button type="button" className="btn" onClick={v.openConnect}>Connect wallet</button>}
        </nav>
      </header>
      <main>
        <section className="hero">
          <h1 className="shout">
            <span className="g-real">UPROAR</span>
            <span className="g-ghost g-a" aria-hidden="true">UPROAR</span>
            <span className="g-ghost g-b" aria-hidden="true">UPROAR</span>
          </h1>
          <p className="hero-line">An open social network on Solana. Your name is yours. Say it loud.</p>
          <div className="hero-cta">
            <Link prefetch={false} className="btn btn-loud" href={cta.href}>{cta.label}</Link>
            <Link prefetch={false} className="btn" href="/home">Read the feed</Link>
          </div>
        </section>
        <section className="beat"><p className="say">Your name, your wallet</p></section>
        <section className="beat beat-right"><p className="say">A sign in the city for every name</p></section>
        <section className="loud" id="loud">
          <TornEdge seed={1013} position="top" />
          <h2>How it works</h2>
          <div className="truths">
            {TRUTHS.map((t) => (
              <div key={t.title}>
                <h3>{t.title}</h3>
                <p>{t.text}</p>
              </div>
            ))}
          </div>
          <TornEdge seed={8932} position="bottom" />
        </section>
        <section className="ending">
          <Link prefetch={false} className="btn btn-loud" style={{ minHeight: 56, padding: '0 30px', fontSize: 17 }} href={cta.href}>{cta.label}</Link>
          {stats.handles > 0 ? <p className="counts">{stats.handles.toLocaleString()} {stats.handles === 1 ? 'name' : 'names'} claimed and {stats.posts.toLocaleString()} {stats.posts === 1 ? 'post' : 'posts'} so far.</p> : null}
        </section>
      </main>
      <footer className="landing-foot">
        <FooterLinks />
        {IS_MAINNET ? null : <span>Test deployment on {CLUSTER}.</span>}
      </footer>
      <ConnectOnly />
    </div>
  );
}
