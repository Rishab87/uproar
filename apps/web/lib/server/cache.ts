/**
 * A short per-instance memo for anonymous, country-scoped reads that every visitor triggers. A hide
 * reaches cached copies within the TTL, which is seconds against legal clocks measured in hours.
 */
const store = new Map<string, { at: number; value: Promise<unknown> }>();
const MAX_KEYS = 500;

export function memo<T>(key: string, ttlMs: number, run: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && now - hit.at < ttlMs) return hit.value as Promise<T>;
  if (store.size >= MAX_KEYS) store.clear();
  const value = run();
  store.set(key, { at: now, value });
  value.catch(() => store.delete(key));
  return value;
}
