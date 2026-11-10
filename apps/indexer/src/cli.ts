#!/usr/bin/env -S npx tsx
/**
 * Run your own UPROAR indexer.
 *
 *   DATABASE_URL=postgres://... RPC_URLS=https://... PROGRAM_ID=... uproar-indexer <command>
 *
 *   migrate     create the tables
 *   backfill    read the whole program history from the ledger into the database
 *   reconcile   fetch anything new since the last run (loop this, or run it from cron)
 *   finalize    mark recorded events as finalized and handle rollbacks
 *   rebuild     throw away the projection and replay the event log
 *   hash        print the state hash, to compare with any other indexer
 */
import { Rpc, backfill, connect, markFinalized, rebuild, reconcile, stateHash } from '@uproar/indexer-core';
import { migrate } from '@uproar/indexer-core/migrate';
import { UPROAR_PROGRAM_ADDRESS } from '@uproar/protocol';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const programId = process.env.PROGRAM_ID ?? (UPROAR_PROGRAM_ADDRESS as string);
const urls = (process.env.RPC_URLS ?? 'http://127.0.0.1:8899').split(',').map((u) => u.trim());
const sql = connect(databaseUrl, { max: 3 });
const rpc = new Rpc(urls);

const commands: Record<string, () => Promise<unknown>> = {
  migrate: () => migrate(sql),
  backfill: () => backfill(sql, rpc, programId, (r) => console.error(r)),
  reconcile: () => reconcile(sql, rpc, programId),
  finalize: () => markFinalized(sql, rpc),
  rebuild: () => rebuild(sql),
  hash: () => stateHash(sql),
};

const command = commands[process.argv[2] ?? ''];
if (!command) {
  console.error(`usage: uproar-indexer ${Object.keys(commands).join('|')}`);
  process.exit(1);
}
const result = await command();
console.log(typeof result === 'string' ? result : JSON.stringify(result));
await sql.end();
