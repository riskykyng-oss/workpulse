import express from 'express';
import http from 'node:http';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { setup } from './config/setup.js';
import routes from './routes/index.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { mockAdapter } from './detection/MockDetectionAdapter.js';
import { presenceService } from './services/presenceService.js';
import { setupSocket } from './socket/attendanceSocket.js';
import { startMonthlyScheduler, startLiveTicker, startNetworkPing } from './jobs/monthlyCompile.js';
import { stopDatabase } from './config/database.js';
import { logger } from './utils/logger.js';

const DEMO_SECRET = 'workpulse-demo-secret-change-me';

async function main() {
  if (env.databaseUrl || env.autoSetup) {
    await setup({ skipGenerate: true });
  } else {
    const { ensureDatabase } = await import('./config/database.js');
    await ensureDatabase();
  }

  const app = express();
  app.use(helmet());
  app.use(cors({ origin: env.frontendOrigin, credentials: true }));
  app.use(express.json({ limit: '2mb' }));

  // Baseline API throttle; login gets a much tighter window below.
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false }));
  app.post('/api/auth/login', rateLimit({ windowMs: 5 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many login attempts. Please try again in a few minutes.' } }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'workpulse-api' }));
  app.use('/api', routes);
  app.use(notFound);
  app.use(errorHandler);

  const server = http.createServer(app);
  setupSocket(server);

  // Detection feed: mock adapter pushes real detections through the pipeline.
  mockAdapter.onDetection((d) => presenceService.handleDetection(d));
  await mockAdapter.start();

  startMonthlyScheduler();
  startLiveTicker();
  startNetworkPing();

  server.listen(env.port, () => {
    logger.info('workpulse-api listening', { port: env.port });
    logger.info('workpulse-api config', { adapter: 'mock', database: env.databaseUrl ? 'sql' : 'embedded' });
    if (env.jwtSecret === DEMO_SECRET) {
      logger.warn('JWT_SECRET is still the demo default', { hint: 'Set JWT_SECRET before any real deployment.' });
    }
  });

  const shutdown = async () => {
    await stopDatabase();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error('WorkPulse failed to start', { err });
  process.exit(1);
});