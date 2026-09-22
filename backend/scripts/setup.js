import { setup } from '../src/config/setup.js';

// Idempotent bootstrap: embedded PostgreSQL boot + schema push + generate +
// seed (only when the database is empty). The cluster is intentionally left
// running so `npm run dev` and subsequent commands reuse it.
try {
  const url = await setup();
  console.log(`WorkPulse database ready: ${url}`);
} catch (err) {
  console.error('Database setup failed:', err?.stack || err);
  process.exitCode = 1;
}