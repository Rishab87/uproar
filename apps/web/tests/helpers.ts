import { randomBytes, createHash } from 'node:crypto';
import { connect, applyTransactions, type IndexedTx, type Sql } from '@uproar/indexer-core';
import { migrate } from '@uproar/indexer-core/migrate';
import { bytesToSignature, type UproarEvent } from '@uproar/protocol';
import postgres from 'postgres';

const URL = process.env.TEST_DATABASE_URL ?? 'postgres://uproar@127.0.0.1:54329/uproar';

export async function testDb() {
  const schema = `w_${randomBytes(6).toString('hex')}`;
  const admin = postgres(URL, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create schema ${schema}`);
  await admin.end();
  const sql = connect(URL, { max: 4, schema });
  await migrate(sql);
  return {
    sql,
    drop: async () => {
      await sql.unsafe(`drop schema ${schema} cascade`);
      await sql.end();
    },
  };
}

export const sig = (label: string) => bytesToSignature(createHash('sha512').update(label).digest());
export const addr = (label: string) => bytesToSignature(createHash('sha512').update(label).digest()).slice(0, 44);
export const prof = (n: string) => addr(`profile:${n}`);

/** A tiny world builder over the real reducers, so tests read like a history of events. */
export class World {
  private slot = 1_000;
  private history: IndexedTx[] = [];
  constructor(private readonly sql: Sql) {}

  private base(n: string) {
    return { signer: addr(`wallet:${n}`), profile: prof(n), session: null };
  }

  private async push(label: string, events: UproarEvent[], blockTime?: number) {
    this.slot += 1;
    const s = sig(`${label}:${this.slot}`);
    const t: IndexedTx = { sig: s, slot: this.slot, blockTime: blockTime ?? Math.floor(Date.now() / 1000), events: events.map((event, ixIndex) => ({ ixIndex, event })) };
    await applyTransactions(this.sql, [t]);
    return s;
  }

  async user(handle: string, name = handle) {
    await this.push(`u:${handle}`, [
      { kind: 'create_profile', authority: addr(`wallet:${handle}`), profile: prof(handle) },
      { kind: 'claim_handle', authority: addr(`wallet:${handle}`), profile: prof(handle), handleAccount: addr(`handle:${handle}`), handle },
      { kind: 'set_profile', ...this.base(handle), name, bio: `bio of ${handle}`, website: '', location: '', avatarSeed: 1, accent: 0 },
    ]);
    return prof(handle);
  }

  post(who: string, text: string, opts: { replyTo?: string; quoteOf?: string; ageHours?: number } = {}) {
    const blockTime = opts.ageHours !== undefined ? Math.floor(Date.now() / 1000) - opts.ageHours * 3600 : undefined;
    return this.push(`p:${who}:${text}`, [{ kind: 'post', ...this.base(who), text, replyTo: opts.replyTo ?? null, quoteOf: opts.quoteOf ?? null }], blockTime);
  }
  like(who: string, post: string) { return this.push(`l:${who}`, [{ kind: 'like', ...this.base(who), post }]); }
  repost(who: string, post: string) { return this.push(`r:${who}`, [{ kind: 'repost', ...this.base(who), post }]); }
  follow(who: string, target: string) { return this.push(`f:${who}`, [{ kind: 'follow', ...this.base(who), target: prof(target) }]); }
  deletePost(who: string, post: string) { return this.push(`d:${who}`, [{ kind: 'delete_post', ...this.base(who), post }]); }
  pin(who: string, post: string) { return this.push(`pin:${who}`, [{ kind: 'pin', ...this.base(who), post }]); }
}
