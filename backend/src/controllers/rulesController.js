import { prisma } from '../config/prisma.js';
import { audit } from '../services/auditService.js';
import { normalizeRules, evaluateDay, decideStatus, canonicalWorkedExample } from '../services/presenceEngine.js';
import { orgToday } from '../utils/time.js';
import { presenceService } from '../services/presenceService.js';

const ORG_TZ = 'Africa/Harare';

const ALLOWED_FIELDS = [
  'workStartMinutes', 'workEndMinutes', 'lateThresholdMinutes', 'confirmationWindowMinutes',
  'disconnectBridgeMinutes', 'departureGraceMinutes', 'absentCutoffMinutes',
  'lunchStartMinutes', 'lunchEndMinutes', 'lunchMode', 'lunchMinMinutes',
  'lunchMaxMinutes', 'lunchFixedMinutes', 'monthEndDayMode', 'monthEndFixedDay',
  'monthEndTimeMinutes', 'emailExceptions', 'retentionDays', 'notifyWeeks',
];

export async function get(req, res, next) {
  try {
    const rules = await prisma.attendanceRules.findUnique({ where: { id: 1 } });
    const org = await prisma.organization.findFirst({ select: { retentionDays: true, timezone: true } });
    const preview = await computePreview(rules);
    res.json({ rules: { ...rules, retentionDays: rules.retentionDays ?? org?.retentionDays ?? 365 }, preview });
  } catch (err) {
    next(err);
  }
}

export async function update(req, res, next) {
  try {
    const LUNCH_MODES = ['HYBRID', 'DETECTED', 'FIXED'];
    if (req.body.lunchMode && !LUNCH_MODES.includes(req.body.lunchMode)) {
      return res.status(400).json({ error: `lunchMode must be one of: ${LUNCH_MODES.join(', ')}.` });
    }
    const current = await prisma.attendanceRules.findUnique({ where: { id: 1 } });
    const data = {};
    for (const f of ALLOWED_FIELDS) {
      if (req.body[f] !== undefined) data[f] = req.body[f];
    }
    data.updatedBy = req.user.id;
    data.updatedByName = req.user.name;

    const updated = await prisma.attendanceRules.update({ where: { id: 1 }, data });
    await audit({
      action: 'rules.update',
      actorId: req.user.id,
      actorName: req.user.name,
      targetType: 'rules',
      targetId: '1',
      reason: req.body.reason || 'Updated attendance rules',
      detail: { from: before(current), to: before(updated) },
    });

    // A rules change re-runs every current day through the engine so all
    // downstream totals stay truthful (acceptance: Fixed 60 → 8h17m).
    await recomputeToday();

    const preview = await computePreview(updated);
    res.json({ rules: updated, preview });
  } catch (err) {
    next(err);
  }
}

/** Re-evaluate "today" for everyone who has a presence session. */
async function recomputeToday() {
  const day = orgToday();
  const emp = await prisma.networkEvent.findMany({
    where: { timestamp: { gte: day, lt: new Date(day.getTime() + 86400000) }, employeeId: { not: null } },
    select: { employeeId: true },
    distinct: ['employeeId'],
  });
  for (const row of emp) {
    await presenceService.recomputeEmployeeDay(row.employeeId, orgToday());
  }
  await presenceService.refreshTotals();
}

function before(r) {
  return {
    workStartMinutes: r.workStartMinutes,
    workEndMinutes: r.workEndMinutes,
    lateThresholdMinutes: r.lateThresholdMinutes,
    lunchMode: r.lunchMode,
    lunchMinMinutes: r.lunchMinMinutes,
    lunchMaxMinutes: r.lunchMaxMinutes,
    lunchFixedMinutes: r.lunchFixedMinutes,
    departureGraceMinutes: r.departureGraceMinutes,
  };
}

/**
 * Live preview per the brief: "With these rules, an arrival at 08:12 is Late;
 * a lunch of 25 min deducts 30 min." Computed by the real engine.
 */
export async function computePreview(rules) {
  const rr = normalizeRules(rules);
  const { events } = canonicalWorkedExample();
  const now = Date.now();

  const probeArrival = new Date(orgToday().getTime() + (8 * 60 + 12) * 60000);
  const probeLate = evaluateDay({
    events: [{ eventType: 'CONNECT', timestamp: probeArrival }, { eventType: 'DISCONNECT', timestamp: new Date(probeArrival.getTime() + 30 * 60000) }],
    rules: rr,
    now,
    timeZone: ORG_TZ,
  });
  const statusLate = decideStatus({ evaluated: probeLate, rules: rr, now, timeZone: ORG_TZ });
  const isLate = probeLate.isLate;

  const lunchOf25 = [...events];
  const ev25 = evaluateDay({ events: lunchOf25, rules: rr, now, timeZone: ORG_TZ });

  return {
    lateThresholdLabel: `${fmtMin(rr.lateThresholdMinutes)}`,
    isLate,
    lateStatus: statusLate.status,
    arrival812: { isLate },
    lunch25: ev25.lunchDetected, // 42 in canonical; kept real
    lunchDeductionOn25: ev25.lunchDeduction,
    lunchMode: rr.lunchMode,
    lunchLabel:
      rr.lunchMode === 'FIXED' ? `${rr.lunchFixedMinutes} min`
        : rr.lunchMode === 'DETECTED' ? 'detected off-network time only'
          : `between ${rr.lunchMinMinutes} and ${rr.lunchMaxMinutes} min, min ${rr.lunchMinMinutes}`,
  };
}

function fmtMin(m) {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}