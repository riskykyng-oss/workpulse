// The Prisma client is created lazily because the embedded-Postgres bootstrap
// assigns DATABASE_URL at runtime — after static imports have already been
// evaluated. A recursive Proxy defers construction to the first actual query,
// so every call site (`prisma.organization.count()`, `prisma.attendanceRecord
// .findMany(...)`, `prisma.$transaction(...)`, ...) keeps working unchanged.
let clientPromise = null;

// Prisma defaults its pool to `n CPU × 2 + 1`, which exceeds the tiny
// connection ceiling of free hosted Postgres (e.g. Render free = 3) and makes
// Postgres kill connections mid-query ("Server has closed the connection").
// Pin a small, explicit limit unless the host URL already overrides it.
function withPoolLimit(url) {
  try {
    const u = new URL(url);
    if (!u.searchParams.has('connection_limit')) u.searchParams.set('connection_limit', '3');
    if (!u.searchParams.has('pool_timeout')) u.searchParams.set('pool_timeout', '5');
    return u.toString();
  } catch {
    return url;
  }
}

export function getClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      if (!process.env.DATABASE_URL) {
        const { ensureDatabase } = await import('./database.js');
        const url = await ensureDatabase();
        process.env.DATABASE_URL = url;
      }
      const { PrismaClient } = await import('@prisma/client');
      return new PrismaClient({
        datasources: { db: { url: withPoolLimit(process.env.DATABASE_URL) } },
        log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
      });
    })().catch((err) => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

export function getPrisma() {
  return getClient();
}

function makeProxy(path) {
  return new Proxy(function () {}, {
    apply(_target, _thisArg, args) {
      return getClient().then((c) => {
        const parts = path.split('.');
        let owner = c;
        for (const part of parts.slice(0, -1)) owner = owner[part];
        const fn = owner[parts[parts.length - 1]];
        return fn.apply(owner, args);
      });
    },
    get(_target, prop) {
      if (prop === 'then') return undefined;
      return makeProxy(path === '' ? prop : `${path}.${prop}`);
    },
  });
}

export const prisma = makeProxy('');