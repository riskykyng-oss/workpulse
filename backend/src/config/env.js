import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

function int(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: int('PORT', 4000),
  jwtSecret: process.env.JWT_SECRET || 'workpulse-demo-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  databaseUrl: process.env.DATABASE_URL || null,
  embeddedPgPort: int('EMBEDDED_PG_PORT', 5433),
  embeddedPgData: process.env.EMBEDDED_PG_DATA || path.join(__dirname, '..', '..', '.pgdata'),
  autoSetup: process.env.AUTO_SETUP !== '0',
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  isDemo: true,
};