import { execFileSync } from 'node:child_process';
import { connect } from '@uproar/indexer-core';
import { migrate } from '@uproar/indexer-core/migrate';

/** A fresh, migrated database for each end-to-end run. Runs before the web server starts. */
const PGBIN = process.env.PGBIN ?? '/opt/homebrew/opt/postgresql@17/bin';
const args = ['-h', '127.0.0.1', '-p', '54329', '-U', 'uproar', '-d', 'postgres', '-c'];
execFileSync(`${PGBIN}/psql`, [...args, `select pg_terminate_backend(pid) from pg_stat_activity where datname = 'uproar_e2e'`], { stdio: 'ignore' });
execFileSync(`${PGBIN}/psql`, [...args, 'drop database if exists uproar_e2e'], { stdio: 'ignore' });
execFileSync(`${PGBIN}/psql`, [...args, 'create database uproar_e2e'], { stdio: 'ignore' });
const sql = connect('postgres://uproar@127.0.0.1:54329/uproar_e2e', { max: 1 });
await migrate(sql);
await sql.end();
console.log('e2e database ready');
