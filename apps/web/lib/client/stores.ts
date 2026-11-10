'use client';
import { useSyncExternalStore } from 'react';

/** A very small store. Local UI state only: everything durable lives on chain or on the server. */
function store<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next: T) => {
      value = next;
      for (const l of listeners) l();
    },
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export type PostOverlay = { liked?: boolean; reposted?: boolean; bookmarked?: boolean; deleted?: boolean };
const overlays = store<Record<string, PostOverlay>>({});

export function setOverlay(sig: string, patch: PostOverlay): void {
  overlays.set({ ...overlays.get(), [sig]: { ...overlays.get()[sig], ...patch } });
}

export function usePostOverlay(sig: string): PostOverlay | undefined {
  return useSyncExternalStore(overlays.subscribe, () => overlays.get()[sig], () => undefined);
}

export type PendingPost = { sig: string; text: string; replyTo: string | null; quoteOf: string | null; at: number };
const pending = store<PendingPost[]>([]);

export const addPending = (p: PendingPost) => pending.set([p, ...pending.get()]);
export const removePending = (sig: string) => pending.set(pending.get().filter((p) => p.sig !== sig));
const EMPTY: PendingPost[] = [];
export const usePending = () => useSyncExternalStore(pending.subscribe, pending.get, () => EMPTY);

export type Toast = { id: number; kind: 'info' | 'error' | 'success'; text: string; action?: { label: string; href: string } };
const toasts = store<Toast[]>([]);
let nextToast = 1;

export function toast(kind: Toast['kind'], text: string, action?: Toast['action']): void {
  const id = nextToast++;
  toasts.set([...toasts.get().slice(-3), { id, kind, text, ...(action ? { action } : {}) }]);
  setTimeout(() => dismissToast(id), kind === 'error' ? 8_000 : 4_500);
}
export const dismissToast = (id: number) => toasts.set(toasts.get().filter((t) => t.id !== id));
const NO_TOASTS: Toast[] = [];
export const useToasts = () => useSyncExternalStore(toasts.subscribe, toasts.get, () => NO_TOASTS);

export type ComposeTarget = { replyTo?: string; replyHandle?: string | null; quoteOf?: string; quoteText?: string | null; quoteHandle?: string | null } | null;
const compose = store<{ open: boolean; target: ComposeTarget }>({ open: false, target: null });
const CLOSED = { open: false, target: null };

export const openCompose = (target: ComposeTarget = null) => compose.set({ open: true, target });
export const closeCompose = () => compose.set(CLOSED);
export const useCompose = () => useSyncExternalStore(compose.subscribe, compose.get, () => CLOSED);

/** Fired when a post lands on chain, so the wordmark can glitch: the one event that earns it. */
const landed = store(0);
export const announceLanded = () => landed.set(landed.get() + 1);
export const useLanded = () => useSyncExternalStore(landed.subscribe, landed.get, () => 0);
