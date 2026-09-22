import { execSync } from 'node:child_process';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { ensureDatabase } from '../src/config/database.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_PORT = 4000;

/** True when a live WorkPulse API looks bound to the given port. */
function probe(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setTimeout(600);
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
  });
}

// Destructive reset: drops all tables (`db push --force-reset`) and re-seeds
// the canonical Harcourt Group demo dataset from scratch.
// The embedded PostgreSQL cluster is intentionally left running afterwards so
// later boots (and `npm run dev`) simply reuse it via the port probe.
const running = await probe(API_PORT);
if (running) {
  console.error(`[reset] ABORTED: a WorkPulse API appears to be running on :${API_PORT}.`);
  console.error('[reset] A live server holds the embedded database open, so `db push --force-reset` would fail with EPERM.');
  console.error('[reset] Stop the backend first (or, when run via `npm run dev`, Ctrl+C both processes), then re-run this reset.');
  process.exit(1);
}

try {
  const url = await ensureDatabase();
  process.env.DATABASE_URL = url;
  console.log('[reset] database target ready');
  execSync(`npx prisma db push --force-reset --skip-generate`, { cwd: root, env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit' });
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
  if (err && err.code === 'EPERM') {
    console.error('[reset] FAILED: the embedded database is in use (EPERM). Stop the running backend before resetting.');
  } else {
    console.error('[reset] FAILED:', err?.stack || err);
  }
  process.exitCode = 1;
}