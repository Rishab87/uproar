import { createHash, randomBytes } from 'node:crypto';
import { bytesToSignature, type UproarEvent } from '@uproar/protocol';
import postgres from 'postgres';
import type { Sql, IndexedTx } from '../src/index';
import { migrate } from '../src/migrate';

export const DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://uproar@127.0.0.1:54329/uproar';

/** Each test gets a private schema, so test files can run in parallel against one server. */
export async function testDb(): Promise<{ sql: Sql; drop: () => Promise<void> }> {
  const schema = `t_${randomBytes(6).toString('hex')}`;
  const admin = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create schema ${schema}`);
  const sql = postgres(DATABASE_URL, {
    max: 4,
    onnotice: () => {},
    connection: { search_path: schema },
  }) as unknown as Sql;
  await migrate(sql);
  return {
    sql,
    drop: async () => {
      await sql.end();
      await admin.unsafe(`drop schema ${schema} cascade`);
      await admin.end();
    },
  };
}

/** A deterministic fake base58 signature or address, from a label. */
export function fakeSig(label: string): string {
  return bytesToSignature(createHash('sha512').update(label).digest());
}

export function fakeAddress(label: string): string {
  return bytesToSignature(createHash('sha512').update(label).digest()).slice(0, 44);
}

export function tx(sig: string, slot: number, events: UproarEvent[], blockTime: number | null = 1_800_000_000 + slot): IndexedTx {
  return { sig, slot, blockTime, events: events.map((event, ixIndex) => ({ ixIndex, event })) };
}

export function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let s = seed;
  const next = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

export function rng(seed: number) {
  let s = seed;
  return (n: number) => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return Math.floor((s / 2 ** 32) * n);
  };
}
