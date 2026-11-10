import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Providers } from './providers';
import './globals.css';

const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

// The Content Security Policy uses a per-request nonce, and Next can only stamp it onto pages
// rendered per request. It also means legal changes are live at once: no page is ever pre-built.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: { default: 'UPROAR', template: '%s | UPROAR' },
  description: 'An open social network on Solana. Your name is yours. This app follows the law, and anyone can build another.',
  applicationName: 'UPROAR',
  openGraph: { type: 'website', siteName: 'UPROAR', title: 'UPROAR', description: 'An open social network on Solana. Your name is yours.', images: ['/api/og/site'] },
  twitter: { card: 'summary_large_image', images: ['/api/og/site'] },
};

export const viewport: Viewport = { themeColor: '#05070c', colorScheme: 'dark', width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preload" href="/fonts/anybody.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/tomorrow-400.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
