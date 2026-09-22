import { prisma } from '../config/prisma.js';
import { attendanceService } from '../services/attendanceService.js';
import { orgDayStart, orgYmd, fmtTime, fmtDate, orgToday } from '../utils/time.js';
import { managerScope } from '../middleware/auth.js';

const ORG_TZ = 'Africa/Harare';

export async function getLive(req, res, next) {
  try {
    const live = await attendanceService.getLive();
    let rows = live.records;
    const scope = managerScope(req);
    if (scope) rows = rows.filter((r) => r.employee.department.id === req.user.departmentId);
    if (req.query.departmentId) rows = rows.filter((r) => r.employee.department.id === String(req.query.departmentId));
    if (req.query.status) rows = rows.filter((r) => r.status === String(req.query.status).toUpperCase());
    if (req.query.q) {
      const q = String(req.query.q).toLowerCase();
      rows = rows.filter((r) => r.employee.name.toLowerCase().includes(q) || r.employee.employeeNo.toLowerCase().includes(q));
    }
    res.json({ date: live.date, records: rows });
  } catch (err) {
    next(err);
  }
}

export async function getHistory(req, res, next) {
  try {
    const q = req.query;
    const to = q.to ? normDate(q.to, true) : undefined;
    const from = q.from ? normDate(q.from, false) : undefined;
    if ((q.from && !from) || (q.to && !to)) return res.status(400).json({ error: 'from/to must be valid dates (YYYY-MM-DD or ISO-8601).' });
    const records = await attendanceService.getHistory({ employeeId: q.employeeId, from, to, departmentId: managerScope(req)?.departmentId });
    res.json({ records });
  } catch (err) {
    next(err);
  }
}

/** Accept 'YYYY-MM-DD' or full ISO strings; end-of-day for `to`. */
function normDate(v, endOfDay) {
  const raw = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return endOfDay ? new Date(`${raw}T23:59:59.999Z`) : new Date(`${raw}T00:00:00.000Z`);
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function getEvidence(req, res, next) {
  try {
    const evidence = await attendanceService.getEvidence(req.params.id);
    if (!evidence) return res.status(404).json({ error: 'Attendance record not found.' });
    const scope = managerScope(req);
    if (scope && evidence.record.employee.department.id !== scope.departmentId) {
      return res.status(403).json({ error: 'You do not have permission to do that.' });
    }
    res.json(evidence);
  } catch (err) {
    next(err);
  }
}

const STATUS_LABEL = { PRESENT: 'Present', LATE: 'Late', ABSENT: 'Absent', ON_LEAVE: 'On leave', NOT_EXPECTED: 'Not expected', NEEDS_REVIEW: 'Needs review', MANUALLY_SET: 'Manually set' };

export async function correctAttendance(req, res, next) {
  try {
    const { changes = {}, reason } = req.body;
    const updated = await attendanceService.correct({
      recordId: req.params.id,
      changes,
      reason,
      actor: { id: req.user.id, name: req.user.name },
    });
    res.json({ record: updated });
  } catch (err) {
    next(err);
  }
}

export async function exceptions(req, res, next) {
  try {
    const items = await attendanceService.getExceptions();
    res.json({ items });
  } catch (err) {
    next(err);
  }
}

/** Month calendar for an employee's Attendance tab. */
export async function employeeMonth(req, res, next) {
  try {
    const { employeeId, month } = req.params;
    const inM = await import('../utils/time.js');
    const start = inM.monthStartUTC(month, ORG_TZ);
    const end = inM.nextMonthStartUTC(month, ORG_TZ);
    const records = await prisma.attendanceRecord.findMany({
      where: { employeeId, date: { gte: start, lt: end } },
      orderBy: { date: 'asc' },
    });
    res.json({
      month,
      days: records.map((r) => ({
        date: r.date,
        label: STATUS_LABEL[r.status] || r.status,
        status: r.status,
        netMinutes: r.netMinutes,
        grossMinutes: r.grossMinutes,
        lunchDeduction: r.lunchDeduction,
        arrival: r.arrivalAt ? fmtTime(r.arrivalAt, ORG_TZ) : null,
        departure: r.departureAt ? fmtTime(r.departureAt, ORG_TZ) : null,
        lateMinutes: r.lateMinutes,
      })),
    });
  } catch (err) {
    next(err);
  }
}

/** Today's row for the employee self-service view (/me). */
export async function today(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.json({ record: null });
    const [orgUser, rules] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.user.id }, include: { employee: { include: { department: true } } } }),
      prisma.attendanceRules.findUnique({ where: { id: 1 } }),
    ]);
    const day = orgToday();
    const record = await prisma.attendanceRecord.findUnique({
      where: { employeeId_date: { employeeId: empId, date: day } },
      include: { employee: { include: { department: true } } },
    });
    if (!record) {
      return res.json({ record: null, workHours: { start: fmtTime(new Date(day.getTime() + rules.workStartMinutes * 60000), ORG_TZ), end: fmtTime(new Date(day.getTime() + rules.workEndMinutes * 60000), ORG_TZ) } });
    }
    res.json({
      record: {
        id: record.id,
        status: record.status,
        arrivalAt: record.arrivalAt,
        departureAt: record.departureAt,
        netMinutes: record.netMinutes,
        grossMinutes: record.grossMinutes,
        lunchDeduction: record.lunchDeduction,
        lateMinutes: record.lateMinutes,
        employeeName: record.employee.name,
        departmentName: record.employee.department.name,
        verifiedThrough: 'Head Office network',
      },
      workHours: {
        start: fmtTime(new Date(day.getTime() + rules.workStartMinutes * 60000), ORG_TZ),
        end: fmtTime(new Date(day.getTime() + rules.workEndMinutes * 60000), ORG_TZ),
      },
    });
  } catch (err) {
    next(err);
  }
}

void fmtDate;