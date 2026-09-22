import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDatabase } from '../src/config/database.js';

// Destructive reset: drops all tables (`db push --force-reset`) and re-seeds
// the canonical Harcourt Group demo dataset from scratch.
// The embedded PostgreSQL cluster is intentionally left running afterwards so
// later boots (and `npm run dev`) simply reuse it via the port probe.
try {
  const url = await ensureDatabase();
  process.env.DATABASE_URL = url;
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  console.log('[reset] database target ready');
  execSync('npx prisma db push --force-reset --skip-generate', { cwd: root, env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit' });
  console.log('[reset] schema reset complete');
  execSync('npx prisma generate', { cwd: root, env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit' });
  console.log('[reset] client generated');
  const { main } = await import('../prisma/seed.js');
  const { prisma } = await import('../src/config/prisma.js');
  await main({ prisma });
  await prisma.$disconnect();
  console.log('[reset] seed complete');
  // Exit now, leaving the embedded cluster running for reuse by `npm run dev`.
  process.exit(0);
} catch (err) {
  console.error('[reset] FAILED:', err?.stack || err);
  process.exitCode = 1;
}