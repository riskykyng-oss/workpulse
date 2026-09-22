import { prisma } from '../config/prisma.js';

/**
 * Write an audit entry. Deliberately kept synchronous-friendly: callers pass a
 * transaction client when the change and its audit trail must be atomic.
 *
 * @param {object} args
 * @param {string} args.action action verb, e.g. "attendance.correct"
 * @param {object} [args.tx] Prisma transaction client
 * @param {string} [args.actorId]
 * @param {string} [args.actorName]
 * @param {string} [args.targetType]
 * @param {string} [args.targetId]
 * @param {string} [args.reason]
 * @param {object} [args.detail]
 */
export async function audit({ action, tx = prisma, actorId = null, actorName = 'System', targetType = null, targetId = null, reason = null, detail = null }) {
  return tx.auditLog.create({
    data: { action, actorId, actorName, targetType, targetId, reason, detail: detail ?? undefined },
  });
}