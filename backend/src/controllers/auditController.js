import { prisma } from '../config/prisma.js';

export async function list(req, res, next) {
  try {
    const where = {};
    if (req.query.action) where.action = String(req.query.action);
    if (req.query.actor) where.actorName = { contains: String(req.query.actor) };
    const logs = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(req.query.limit || 200), 500),
    });
    res.json({
      logs: logs.map((l) => ({
        id: l.id,
        action: l.action,
        actorName: l.actorName,
        targetType: l.targetType,
        targetId: l.targetId,
        reason: l.reason,
        detail: l.detail,
        createdAt: l.createdAt,
      })),
      actions: await prisma.auditLog.groupBy({ by: ['action'], orderBy: { action: 'asc' } }).then((a) => a.map((x) => x.action)),
    });
  } catch (err) {
    next(err);
  }
}