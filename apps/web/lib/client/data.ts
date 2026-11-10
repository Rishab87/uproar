'use client';
import { useEffect } from 'react';
import useSWR, { type SWRConfiguration } from 'swr';
import useSWRInfinite from 'swr/infinite';
import type { Page } from '@/lib/server/queries';
import { useViewer } from './viewer';

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/**
 * After someone's action lands, every list or count it can change reloads at once. SWR's filter form of
 * mutate can't do this: it skips infinite lists and our keys are arrays, so it never matched anything.
 */
const bus = new EventTarget();
const AFFECTED = ['/api/feed', '/api/profile', '/api/post', '/api/notifications', '/api/bookmarks', '/api/search', '/api/tag', '/api/who-to-follow'];

export function refreshAfterAction(only?: string): void {
  bus.dispatchEvent(new CustomEvent('refresh', { detail: only ?? null }));
}

function useRefreshAfterAction(path: string | null, revalidate: () => unknown): void {
  useEffect(() => {
    if (!path) return;
    const listener = (e: Event) => {
      const only = (e as CustomEvent<string | null>).detail;
      if (only ? path.startsWith(only) : AFFECTED.some((prefix) => path.startsWith(prefix))) void revalidate();
    };
    bus.addEventListener('refresh', listener);
    return () => bus.removeEventListener('refresh', listener);
  }, [path, revalidate]);
}

/** A GET that's signed when a session exists, so the server applies this viewer's private filters. */
export function useApi<T>(path: string | null, config: SWRConfiguration<T> = {}) {
  const { signedFetch, profile, session } = useViewer();
  const viewerKey = session && profile ? profile.address : 'anon';
  const swr = useSWR<T>(path ? [path, viewerKey] : null, async ([p]: [string, string]) => parse<T>(await signedFetch(p)), config);
  useRefreshAfterAction(path, swr.mutate);
  return swr;
}

export function usePaged<T>(path: string | null, options: { initial?: Page<T> | undefined; refreshMs?: number } = {}) {
  const { signedFetch, profile, session } = useViewer();
  const viewerKey = session && profile ? profile.address : 'anon';
  const swr = useSWRInfinite<Page<T>>(
    (index, previous) => {
      if (!path) return null;
      if (previous && !previous.nextCursor) return null;
      const sep = path.includes('?') ? '&' : '?';
      return [index === 0 ? path : `${path}${sep}cursor=${encodeURIComponent(previous?.nextCursor ?? '')}`, viewerKey];
    },
    async ([p]: [string, string]) => parse<Page<T>>(await signedFetch(p)),
    {
      revalidateFirstPage: true,
      revalidateOnFocus: true,
      ...(options.refreshMs ? { refreshInterval: options.refreshMs } : {}),
      // Only the anonymous first page was rendered on the server. A signed-in viewer gets their own.
      ...(options.initial && viewerKey === 'anon' ? { fallbackData: [options.initial] } : {}),
    },
  );
  useRefreshAfterAction(path, swr.mutate);
  const pages = swr.data ?? [];
  const items = pages.flatMap((p) => p.items);
  const last = pages[pages.length - 1];
  const hasMore = Boolean(last?.nextCursor);
  const loading = swr.isLoading || (swr.size > 0 && swr.data !== undefined && swr.data[swr.size - 1] === undefined && hasMore);
  return { items, hasMore, loading, error: swr.error as Error | undefined, loadMore: () => swr.setSize((s) => s + 1), mutate: swr.mutate };
}
