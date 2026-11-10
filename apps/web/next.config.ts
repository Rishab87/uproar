import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const here = dirname(fileURLToPath(import.meta.url));

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@uproar/protocol', '@uproar/indexer-core', '@uproar/safety'],
  serverExternalPackages: ['postgres'],
  outputFileTracingRoot: join(here, '../..'),
  outputFileTracingIncludes: { '/api/og/**': ['./assets/og/**'] },
  turbopack: { root: join(here, '../..') },
  images: { unoptimized: true },
  async rewrites() {
    return [{ source: '/@:handle', destination: '/u/:handle' }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
        ],
      },
    ];
  },
};

export default config;
