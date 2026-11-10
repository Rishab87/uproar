'use client';
import type { ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { ViewerProvider } from '@/lib/client/viewer';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SWRConfig value={{ dedupingInterval: 2_000, errorRetryCount: 3, keepPreviousData: true }}>
      <ViewerProvider>{children}</ViewerProvider>
    </SWRConfig>
  );
}
