import { connect, Rpc, type Sql } from '@uproar/indexer-core';
import { env } from './env';

const holder = globalThis as unknown as { __uproarSql?: Sql; __uproarRpc?: Rpc };

export function getSql(): Sql {
  holder.__uproarSql ??= connect(env.databaseUrl, { max: Number(process.env.DB_POOL_MAX ?? 3), ...(process.env.DB_SCHEMA ? { schema: process.env.DB_SCHEMA } : {}) });
  return holder.__uproarSql;
}

export function getRpc(): Rpc {
  holder.__uproarRpc ??= new Rpc(env.rpcUrls);
  return holder.__uproarRpc;
}
