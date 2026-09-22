import { execFileSync } from 'node:child_process';
import path from 'node:path';
import pg from 'pg';

/**
 * DB-backed integration suites need a real PostgreSQL with the canonical schema
 * + seed. Runs once before the worker pools:
 *
 *   1. CREATE DATABASE <name> when missing (server must be reachable),
 *   2. prisma db push --force-reset   (drop + re-push the schema),
 *   3. node prisma/seed.js            (canonical dataset).
 *
 * Opt out entirely by leaving TEST_DATABASE_URL unset.
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;

  const parsed = new URL(url);
  const dbName = parsed.pathname.replace(/^\//, '').split('?')[0];
  const admin = {
    host: parsed.hostname,
    port: Number(parsed.port || 5432),
    user: parsed.username || 'postgres',
    password: parsed.password || '',
    database: 'postgres',
  };

  const client = new pg.Client(admin);
  await client.connect();
  const found = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (found.rowCount === 0) {
    await client.query(`CREATE DATABASE "${dbName}"`);
  }
  await client.end();

  const backendDir = path.join(__dirname, '..');
  const env = { ...process.env, DATABASE_URL: url };
  const repoRoot = path.join(backendDir, '..');
  const prismaCli = path.join(repoRoot, 'node_modules', 'prisma', 'build', 'index.js');

  execFileSync(process.execPath, [prismaCli, 'db', 'push', '--force-reset', '--skip-generate'], { cwd: backendDir, env, stdio: 'inherit' });
  execFileSync(process.execPath, ['prisma/seed.js'], { cwd: backendDir, env, stdio: 'inherit' });
}