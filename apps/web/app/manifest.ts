import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'UPROAR',
    short_name: 'UPROAR',
    description: 'An open social network on Solana.',
    start_url: '/home',
    display: 'standalone',
    background_color: '#05070c',
    theme_color: '#05070c',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
