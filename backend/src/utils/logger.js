const LEVELS = ['debug', 'info', 'warn', 'error'];

function sanitize(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v instanceof Error) {
      out[k] = { message: v.message, status: v.status, stack: v.stack };
    } else if (v instanceof Date) {
      out[k] = v.toISOString();
    } else {
      out[k] = v;
    }
  }
  return out;
}

function emit(level, msg, fields = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...sanitize(fields) });
  if (LEVELS.indexOf(level) >= LEVELS.indexOf('warn')) process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

/** Minimal structured logger: one JSON object per line (stdout=debug/info, stderr=warn/error). */
export const logger = {
  debug: (msg, fields) => emit('debug', msg, fields),
  info: (msg, fields) => emit('info', msg, fields),
  warn: (msg, fields) => emit('warn', msg, fields),
  error: (msg, fields) => emit('error', msg, fields),
};