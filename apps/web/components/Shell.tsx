'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CLUSTER, IS_MAINNET } from '@/lib/client/config';
import { useApi } from '@/lib/client/data';
import { closeCompose, openCompose, useCompose, useLanded } from '@/lib/client/stores';
import { ConnectWalletRow, useViewer } from '@/lib/client/viewer';
import type { NotificationView, Page } from '@/lib/server/queries';
import { Avatar } from './Avatar';
import { Composer } from './Composer';
import { IconBell, IconBookmark, IconGear, IconHome, IconPlus, IconSearch, IconUser } from './icons';
import { Menu } from './Menu';
import { Modal } from './Modal';
import { QuotedPreview } from './QuotedPreview';
import { Toasts } from './Toasts';

export function Wordmark({ size = 'md' }: { size?: 'md' | 'sm' }) {
  const landed = useLanded();
  const [glitching, setGlitching] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setGlitching(true);
    const t = setTimeout(() => setGlitching(false), 340);
    return () => clearTimeout(t);
  }, [landed]);
  return (
    <Link href="/" className={`wordmark wordmark-${size}${glitching ? ' is-glitching' : ''}`} aria-label="UPROAR home">
      <span className="g-real">UPROAR</span>
      <span className="g-ghost g-a" aria-hidden="true">UPROAR</span>
      <span className="g-ghost g-b" aria-hidden="true">UPROAR</span>
    </Link>
  );
}

export const LAST_SEEN_KEY = 'uproar.notifications.seen';

function useUnread(): boolean {
  const v = useViewer();
  const { data } = useApi<Page<NotificationView>>(v.session && v.profile ? '/api/notifications' : null, { refreshInterval: 30_000 });
  const newest = data?.items[0]?.slot ?? 0;
  const [seen, setSeen] = useState(0);
  const pathname = usePathname();
  useEffect(() => {
    setSeen(Number(localStorage.getItem(LAST_SEEN_KEY) ?? 0));
  }, [pathname, data]);
  return newest > seen && pathname !== '/notifications';
}

const NAV = (handle: string | null) => [
  { href: '/home', label: 'Home', icon: IconHome },
  { href: '/explore', label: 'Explore', icon: IconSearch },
  { href: '/notifications', label: 'Notifications', icon: IconBell, needs: true },
  { href: '/bookmarks', label: 'Bookmarks', icon: IconBookmark, needs: true },
  { href: handle ? `/@${handle}` : '/claim', label: 'Profile', icon: IconUser, needs: true },
  { href: '/settings', label: 'Settings', icon: IconGear, needs: true },
];

function AccountChip() {
  const v = useViewer();
  if (!v.account) return <button type="button" className="btn btn-block" onClick={v.openConnect}>Connect wallet</button>;
  const handle = v.profile?.handle ?? v.pendingProfile?.handle ?? null;
  return (
    <div className="account-chip">
      <Avatar author={v.profile ?? { address: v.account.address, avatarSeed: 0, accent: 0 }} size={36} />
      <div className="account-text">
        <strong>{v.profile?.name || (handle ? `@${handle}` : 'No name yet')}</strong>
        <span>{handle ? `@${handle}` : `${v.account.address.slice(0, 4)}...${v.account.address.slice(-4)}`}</span>
      </div>
      <Menu label="Account" trigger={<span aria-hidden="true">...</span>}>
        {(close) => (
          <>
            {!handle ? <Link prefetch={false} role="menuitem" href="/claim" onClick={close}>Claim your name</Link> : null}
            <Link prefetch={false} role="menuitem" href="/settings" onClick={close}>Settings</Link>
            <button role="menuitem" onClick={() => { close(); v.disconnect(); }}>Disconnect wallet</button>
          </>
        )}
      </Menu>
    </div>
  );
}

function Nav() {
  const pathname = usePathname();
  const v = useViewer();
  const unread = useUnread();
  const handle = v.profile?.handle ?? null;
  const items = NAV(handle);
  return (
    <nav className="nav" aria-label="Main">
      <Wordmark />
      <ul className="nav-list">
        {items.filter((i) => !i.needs || v.account).map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== '/home' && pathname.startsWith(href));
          return (
            <li key={href}>
              <Link href={href} aria-label={label} className={active ? 'nav-item is-active' : 'nav-item'} aria-current={active ? 'page' : undefined}>
                <Icon filled={active} />
                <span>{label}</span>
                {label === 'Notifications' && unread ? <span className="dot" aria-label="New notifications" /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
      <button type="button" className="btn btn-loud btn-post" onClick={() => openCompose()}>Post</button>
      <div className="nav-foot"><AccountChip /></div>
    </nav>
  );
}

function BottomBar() {
  const pathname = usePathname();
  const v = useViewer();
  const unread = useUnread();
  const handle = v.profile?.handle ?? null;
  const items = NAV(handle).filter((i) => ['Home', 'Explore', 'Notifications', 'Profile'].includes(i.label)).filter((i) => !i.needs || v.account);
  return (
    <nav className="bottom-bar" aria-label="Main, phone">
      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || (href !== '/home' && pathname.startsWith(href));
        return (
          <Link key={href} href={href} aria-label={label} className={active ? 'is-active' : ''} aria-current={active ? 'page' : undefined}>
            <Icon filled={active} size={24} />
            {label === 'Notifications' && unread ? <span className="dot" /> : null}
          </Link>
        );
      })}
      {!v.account ? <button type="button" className="bottom-connect" onClick={v.openConnect}>Connect</button> : null}
    </nav>
  );
}

function TopBar() {
  const v = useViewer();
  return (
    <header className="top-bar">
      <Wordmark size="sm" />
      {v.account ? (
        <Link href="/settings" aria-label="Settings"><Avatar author={v.profile ?? { address: v.account.address, avatarSeed: 0, accent: 0 }} size={32} /></Link>
      ) : null}
    </header>
  );
}

function ComposeModal() {
  const { open, target } = useCompose();
  if (!open) return null;
  return (
    <Modal title={target?.replyTo ? 'Reply' : target?.quoteOf ? 'Quote' : 'New post'} onClose={closeCompose}>
      <Composer autoFocus replyTo={target?.replyTo} replyHandle={target?.replyHandle} quoteOf={target?.quoteOf} onPosted={closeCompose} />
      {target?.quoteOf ? <QuotedPreview text={target.quoteText ?? ''} handle={target.quoteHandle ?? null} /> : null}
    </Modal>
  );
}

const WALLET_LINKS = [
  { name: 'Phantom', href: 'https://phantom.com/download' },
  { name: 'Solflare', href: 'https://solflare.com/download' },
  { name: 'Backpack', href: 'https://backpack.app/download' },
];

function ConnectModal() {
  const v = useViewer();
  const [inApp, setInApp] = useState<string | null>(null);
  useEffect(() => {
    if (v.connectOpen && /iPhone|iPad|Android/i.test(navigator.userAgent)) setInApp(window.location.href);
  }, [v.connectOpen]);
  if (!v.connectOpen) return null;
  return (
    <Modal title="Connect a wallet" onClose={v.closeConnect}>
      {v.wallets.length ? (
        <div className="wallet-list">
          {v.wallets.map((w) => <ConnectWalletRow key={w.name} wallet={w} onConnected={() => v.selectWallet(w.name)} />)}
        </div>
      ) : (
        <div className="stack">
          <p>No Solana wallet found in this browser.</p>
          {inApp ? (
            <>
              <p className="dim">On a phone, open this page inside your wallet app.</p>
              <a className="btn btn-loud btn-block" href={`https://phantom.app/ul/browse/${encodeURIComponent(inApp)}?ref=${encodeURIComponent(new URL(inApp).origin)}`}>Open in Phantom</a>
              <a className="btn btn-block" href={`https://solflare.com/ul/v1/browse/${encodeURIComponent(inApp)}?ref=${encodeURIComponent(new URL(inApp).origin)}`}>Open in Solflare</a>
            </>
          ) : (
            <ul className="plain-links">
              {WALLET_LINKS.map((w) => <li key={w.name}><a href={w.href} target="_blank" rel="noopener noreferrer">Get {w.name}</a></li>)}
            </ul>
          )}
        </div>
      )}
      <p className="dim small">Connecting shares your public address. It can&apos;t move your funds.</p>
      {!IS_MAINNET ? <p className="dim small">This beta runs on Solana {CLUSTER}. Set your wallet to devnet first: in Phantom, Settings, Developer Settings, Testnet Mode.</p> : null}
    </Modal>
  );
}

function ClusterBanner() {
  if (IS_MAINNET) return null;
  return <div className="cluster-banner">Test deployment on {CLUSTER}. It uses free test SOL, and data can be reset.</div>;
}

function NoticeBanner() {
  const { data } = useApi<{ quarter: string; title: string; body: string } | null>('/api/notice', { revalidateOnFocus: false });
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    if (data) setDismissed(localStorage.getItem(`uproar.notice.${data.quarter}`) !== null);
  }, [data]);
  if (!data || dismissed) return null;
  return (
    <aside className="notice">
      <div className="notice-line">
        <details>
          <summary>{data.title}<span>Read it</span></summary>
          <p>{data.body} <Link prefetch={false} href="/rules">Read the full rules.</Link></p>
        </details>
        <button type="button" className="btn" onClick={() => { localStorage.setItem(`uproar.notice.${data.quarter}`, new Date().toISOString()); setDismissed(true); }}>Got it</button>
      </div>
    </aside>
  );
}

function SessionNudge() {
  const v = useViewer();
  if (!v.profile?.handle || v.session || !v.sessionKeysSupported) return null;
  return (
    <aside className="nudge">
      <span>Your wallet will ask you to approve every action.</span>
      <Link prefetch={false} href="/settings#session" className="btn">Start a session</Link>
    </aside>
  );
}

export function AppShell({ children, side }: { children: ReactNode; side: ReactNode }) {
  return (
    <div className="shell">
      <ClusterBanner />
      <TopBar />
      <div className="shell-grid">
        <aside className="shell-nav"><Nav /></aside>
        <main className="shell-main" id="main">
          <NoticeBanner />
          <SessionNudge />
          {children}
        </main>
        <aside className="shell-side">{side}</aside>
      </div>
      <button type="button" className="fab" aria-label="New post" onClick={() => openCompose()}><IconPlus size={26} /></button>
      <BottomBar />
      <ComposeModal />
      <ConnectModal />
      <Toasts />
    </div>
  );
}
