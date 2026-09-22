import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';
import { env } from './env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let epg = null;
let managed = false;

/**
 * Boots a database connection target, preferring an explicit DATABASE_URL.
 * When none is configured, an embedded (real) PostgreSQL cluster is started on
 * the loopback interface so the entire product is demoable with zero install.
 *
 * @returns {Promise<string>} the active DATABASE_URL
 */
export async function ensureDatabase() {
  if (env.databaseUrl) {
    process.env.DATABASE_URL = env.databaseUrl;
    return env.databaseUrl;
  }

  mkdirSync(env.embeddedPgData, { recursive: true });
  const port = env.embeddedPgPort;

  // If a cluster already answers on the embedded port, reuse it (previous boot
  // may have left it running in an orphaned process).
  const { default: pg } = await import('pg');
  const probe = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password: 'postgres', database: 'postgres', connectionTimeoutMillis: 1200 });
  try {
    await probe.connect();
    await probe.end();
  } catch {
    epg = new EmbeddedPostgres({
      databaseDir: env.embeddedPgData,
      port,
      user: 'postgres',
      password: 'postgres',
      persistent: true,
      timeout: 120000,
      onLog: () => {},
      onError: () => {},
    });
    if (!existsSync(path.join(env.embeddedPgData, 'PG_VERSION'))) {
      await epg.initialise();
    }
    await epg.start();
    managed = true;
  }

  const { default: clientModule } = await import('pg');
  const client = new clientModule.Client({ host: '127.0.0.1', port, user: 'postgres', password: 'postgres', database: 'postgres' });
  await client.connect();
  const found = await client.query("SELECT 1 FROM pg_database WHERE datname = 'workpulse'");
  if (found.rowCount === 0) {
    await client.query('CREATE DATABASE workpulse');
  }
  await client.end();

  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/workpulse?schema=public`;
  process.env.DATABASE_URL = url;
  return url;
}

export async function stopDatabase() {
  if (epg && managed) {
    try {
      await epg.stop();
    } catch {
      /* best effort */
    }
  }
}

export { EmbeddedPostgres };