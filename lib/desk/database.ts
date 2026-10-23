import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { attachDatabasePool } from '@vercel/functions';

export type Connection = {
  prepare: (sql: string) => {
    get: (...values: unknown[]) => Promise<unknown>;
    all: (...values: unknown[]) => Promise<unknown[]>;
    run: (...values: unknown[]) => Promise<{ changes: number }>;
  };
  exec: (sql: string) => Promise<void>;
  close: () => Promise<void>;
};
const context = new AsyncLocalStorage<Connection>();
const globals = globalThis as typeof globalThis & {
  deskPool?: Pool;
  deskSqlite?: DatabaseSync;
  deskReady?: Promise<void>;
  deskMutex?: Promise<void>;
};
export const usesPostgres = () =>
  !!process.env.DATABASE_URL && !process.env.DESK_DB_PATH;
export function schemaName() {
  const schema = process.env.DESK_DB_SCHEMA || 'desk';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema))
    throw new Error('Invalid database namespace');
  return schema;
}
function pgSql(sql: string) {
  let index = 0;
  return sql
    .replace(
      /\b(events|users|sessions|files|rate_limits)\b/g,
      `"${schemaName()}"."$1"`,
    )
    .replace(/\?/g, () => `$${++index}`);
}
function pool() {
  if (!globals.deskPool) {
    globals.deskPool = new Pool({
      connectionString: verifiedConnectionString(process.env.DATABASE_URL),
      max: 5,
      idleTimeoutMillis: 5000,
      connectionTimeoutMillis: 15000,
    });
    if (process.env.VERCEL) attachDatabasePool(globals.deskPool);
  }
  return globals.deskPool;
}
export function verifiedConnectionString(value?: string) {
  if (!value) return value;
  const url = new URL(value);
  if (
    ['require', 'prefer', 'verify-ca'].includes(
      url.searchParams.get('sslmode') || '',
    )
  )
    url.searchParams.set('sslmode', 'verify-full');
  return url.toString();
}
function postgres(client?: PoolClient): Connection {
  const execute = async (sql: string, values: unknown[] = []) => {
    await ready();
    return (client || pool()).query(pgSql(sql), values);
  };
  return {
    prepare: (sql) => ({
      get: async (...values) => (await execute(sql, values)).rows[0],
      all: async (...values) => (await execute(sql, values)).rows,
      run: async (...values) => ({
        changes: (await execute(sql, values)).rowCount || 0,
      }),
    }),
    exec: async (sql) => {
      await execute(sql);
    },
    close: async () => {
      await globals.deskPool?.end();
      globals.deskPool = undefined;
      globals.deskReady = undefined;
    },
  };
}
function sqlite(): Connection {
  if (!globals.deskSqlite) {
    if (process.env.VERCEL)
      throw new Error('Persistent database is required on Vercel.');
    const filename =
      process.env.DESK_DB_PATH ||
      path.join(process.cwd(), '.data', 'desk.sqlite');
    if (filename !== ':memory:')
      mkdirSync(path.dirname(filename), { recursive: true });
    const raw = new DatabaseSync(filename);
    raw.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id), role TEXT NOT NULL, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, skills TEXT NOT NULL DEFAULT '[]');
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id), project_id TEXT NOT NULL, mime TEXT NOT NULL, content BLOB, blob_path TEXT);
      CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, count INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS users_event ON users(event_id);`);
    if (
      !(
        raw.prepare('PRAGMA table_info(files)').all() as { name: string }[]
      ).some((c) => c.name === 'blob_path')
    )
      raw.exec('ALTER TABLE files ADD COLUMN blob_path TEXT');
    globals.deskSqlite = raw;
  }
  const raw = globals.deskSqlite;
  return {
    prepare: (sql) => ({
      get: async (...values) =>
        raw
          .prepare(sql)
          .get(
            ...(values as Parameters<
              ReturnType<DatabaseSync['prepare']>['get']
            >),
          ),
      all: async (...values) =>
        raw
          .prepare(sql)
          .all(
            ...(values as Parameters<
              ReturnType<DatabaseSync['prepare']>['all']
            >),
          ),
      run: async (...values) => ({
        changes: Number(
          raw
            .prepare(sql)
            .run(
              ...(values as Parameters<
                ReturnType<DatabaseSync['prepare']>['run']
              >),
            ).changes,
        ),
      }),
    }),
    exec: async (sql) => {
      raw.exec(sql);
    },
    close: async () => {
      raw.close();
      globals.deskSqlite = undefined;
    },
  };
}
export function db(): Connection {
  const current = context.getStore();
  if (current) return current;
  if (usesPostgres()) return postgres();
  const local = sqlite();
  return {
    prepare: (sql) => ({
      get: (...values) => transaction(() => local.prepare(sql).get(...values)),
      all: (...values) => transaction(() => local.prepare(sql).all(...values)),
      run: (...values) => transaction(() => local.prepare(sql).run(...values)),
    }),
    exec: (sql) => transaction(() => local.exec(sql)),
    close: local.close,
  };
}
export async function ready() {
  if (!usesPostgres()) {
    sqlite();
    return;
  }
  // Schema changes are versioned in migrations; never create an ephemeral fallback on Vercel.
  if (!globals.deskReady)
    globals.deskReady = pool()
      .query(`SELECT 1 FROM "${schemaName()}".events LIMIT 0`)
      .then(() => {});
  try {
    await globals.deskReady;
  } catch (error) {
    globals.deskReady = undefined;
    throw error;
  }
}
export async function transaction<T>(
  fn: () => T | Promise<T>,
  lock = 'global',
): Promise<T> {
  if (context.getStore()) return fn();
  if (usesPostgres()) {
    await ready();
    const client = await pool().connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout = '30s'");
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [`${schemaName()}:${lock}`],
      );
      const result = await context.run(postgres(client), fn);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  // Async callbacks must not interleave transactions on the single local SQLite connection.
  const previous = globals.deskMutex || Promise.resolve();
  let release!: () => void;
  globals.deskMutex = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  const connection = sqlite();
  try {
    await connection.exec('BEGIN IMMEDIATE');
    const result = await context.run(connection, fn);
    await connection.exec('COMMIT');
    return result;
  } catch (error) {
    await connection.exec('ROLLBACK');
    throw error;
  } finally {
    release();
  }
}
