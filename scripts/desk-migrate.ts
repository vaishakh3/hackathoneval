import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { schemaName, verifiedConnectionString } from '../lib/desk/database';

const schema = schemaName();
const pool = new Pool({
  connectionString: verifiedConnectionString(
    process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL,
  ),
  max: 1,
});
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    `${schema}:migrations`,
  ]);
  await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  await client.query(`SET LOCAL search_path TO "${schema}"`);
  await client.query(
    'CREATE TABLE IF NOT EXISTS migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
  );
  const version = '001-initial';
  if (
    !(
      await client.query('SELECT version FROM migrations WHERE version=$1', [
        version,
      ])
    ).rowCount
  ) {
    await client.query(
      await readFile(
        new URL('../lib/desk/migrations/001-initial.sql', import.meta.url),
        'utf8',
      ),
    );
    await client.query('INSERT INTO migrations(version) VALUES($1)', [version]);
  }
  await client.query('COMMIT');
  console.log(`Database migration applied: ${schema}/${version}`);
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
