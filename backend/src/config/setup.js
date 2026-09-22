import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Database bootstrap used by both `server.js` and `npm run setup`.
 *
 * 1. ensures a database target exists (explicit URL or embedded PostgreSQL)
 * 2. pushes the Prisma schema (idempotent)
 * 3. generates the client
 * 4. seeds the canonical demo dataset when the DB is empty
 */
export async function setup(options = {}) {
  const { ensureDatabase } = await import('./database.js');
  const url = await ensureDatabase();
  process.env.DATABASE_URL = url;

  execSync('npx prisma db push --skip-generate', {
    cwd: backendRoot(),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
  // Generate is skipped on server boot: the running process has already mapped
  // the query engine DLL, so replacing it mid-flight fails on Windows. Setup
  // (npm run setup) and reset scripts generate it beforehand.
  if (!options.skipGenerate) {
    execSync('npx prisma generate', {
      cwd: backendRoot(),
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'inherit',
    });
  }

  const { prisma } = await import('./prisma.js');
  const orgCount = await prisma.organization.count();
  if (orgCount === 0) {
    const { main } = await import('../../prisma/seed.js');
    await main({ prisma });
  }
  return url;
}

function backendRoot() {
  return path.join(__dirname, '..', '..');
}