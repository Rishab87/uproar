import postgres from 'postgres';

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;
export type AnySql = Sql | Tx;

/** The default pool settings suit Supavisor's transaction mode and short-lived functions. */
export function connect(url: string, options: { max?: number; schema?: string } = {}): Sql {
  return postgres(url, {
    max: options.max ?? 3,
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false,
    // One query in flight per connection. Behind a transaction pooler (Supavisor, PgBouncer) a pipelined
    // query's reply can be lost, and the caller then waits forever. Found on Supabase: queue() sends four
    // queries at once over a pool of three, and the fourth never came back.
    max_pipeline: 1,
    onnotice: () => {},
    ...(options.schema ? { connection: { search_path: options.schema } } : {}),
  });
}
