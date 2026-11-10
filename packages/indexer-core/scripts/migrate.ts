import { connect } from '../src/index';
import { migrate } from '../src/migrate';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const sql = connect(url, { max: 1 });
const applied = await migrate(sql);
console.log(applied.length ? `applied: ${applied.join(', ')}` : 'already up to date');
await sql.end();
