import { logger } from '../utils/logger.js';

/** Keep errors human. Never leak SQL or internal stack traces. */
export function errorHandler(err, _req, res, _next) {
  const status = err.status || 500;
  if (status === 500) {
    logger.error('unhandled error', { err });
  }
  const message = status === 500
    ? 'Something went wrong on our side. Please try again.'
    : err.message;
  res.status(status).json({ error: message });
}

/** Not-found fallback for unknown API routes. */
export function notFound(_req, res) {
  res.status(404).json({ error: 'Not found.' });
}