import { prisma } from '../config/prisma.js';
import { presenceService } from '../services/presenceService.js';
import { attendanceService } from '../services/attendanceService.js';
import { monthStartUTC, nextMonthStartUTC, orgYmd, fmtTime } from '../utils/time.js';
import { managerScope } from '../middleware/auth.js';

const ORG_TZ = 'Africa/Harare';

export async function list(req, res, next) {
  try {
    const scope = managerScope(req);
    const departments = await prisma.department.findMany({
      where: scope ? { id: scope.departmentId } : undefined,
      orderBy: { name: 'asc' },
      include: { _count: { select: { employees: true } }, manager: { select: { id: true, name: true, position: true } } },
    });
    const totals = await presenceService.computeTotals();
    const byDept = new Map(totals.byDepartment.map((d) => [d.id, d]));
    res.json({
      departments: departments.map((d) => {
        const t = byDept.get(d.id) || { present: 0, late: 0, absent: 0, onLeave: 0, notExpected: 0, needsReview: 0 };
        return {
          id: d.id,
          name: d.name,
          manager: d.manager,
          headcount: d._count.employees,
          present: t.present,
          late: t.late,
          absent: t.absent,
          onLeave: t.onLeave,
          notExpected: t.notExpected,
          attendanceRate: d._count.employees ? Math.round((t.present / d._count.employees) * 1000) / 10 : 0,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
}

export async function detail(req, res, next) {
  try {
    const id = req.params.id;
    const scope = managerScope(req);
    if (scope && id !== scope.departmentId) {
      return res.status(403).json({ error: 'You do not have permission to do that.' });
    }
    const department = await prisma.department.findUnique({
      where: { id },
      include: { manager: { select: { id: true, name: true, position: true } }, _count: { select: { employees: true } } },
    });
    if (!department) return res.status(404).json({ error: 'Department not found.' });

    const live = await attendanceService.getLive(new Date());
    const rows = live.records.filter((r) => r.employee.department.id === id);

    // Current month aggregates from the register (no compile needed).
    const month = orgYmd(new Date(), ORG_TZ).slice(0, 7);
    const start = monthStartUTC(month, ORG_TZ);
    const end = nextMonthStartUTC(month, ORG_TZ);
    const records = await prisma.attendanceRecord.findMany({
      where: { date: { gte: start, lt: end }, employee: { departmentId: id } },
      include: { employee: true },
      orderBy: { date: 'asc' },
    });

    const perDay = new Map();
    let presentDays = 0;
    let netSum = 0;
    let netCount = 0;
    let arrivalSum = 0;
    let arrivalCount = 0;
    const lateByEmployee = new Map();
    let workingDaySet = new Set();
    for (const r of records) {
      const dd = r.date.toISOString().slice(0, 10);
      if (!perDay.has(dd)) perDay.set(dd, { date: dd, present: 0 });
      if (r.status === 'PRESENT' || r.status === 'LATE') {
        perDay.get(dd).present++;
        presentDays++;
        netSum += r.netMinutes;
        netCount++;
        if (r.arrivalAt) { arrivalSum += r.arrivalAt.getHours() * 60 + r.arrivalAt.getMinutes(); arrivalCount++; }
        if (r.status === 'LATE') lateByEmployee.set(r.employeeId, (lateByEmployee.get(r.employeeId) || 0) + 1);
        workingDaySet.add(dd);
      }
    }

    const topLate = await prisma.attendanceRecord.groupBy({
      by: ['employeeId'],
      where: { date: { gte: start, lt: end }, status: 'LATE', employee: { departmentId: id } },
      _count: { _all: true },
      orderBy: { _count: { employeeId: 'desc' } },
      take: 5,
    });
    const empIds = topLate.map((t) => t.employeeId);
    const employees = await prisma.employee.findMany({ where: { id: { in: empIds } }, select: { id: true, name: true } });
    const nameMap = new Map(employees.map((e) => [e.id, e.name]));

    res.json({
      department: {
        id: department.id,
        name: department.name,
        manager: department.manager,
        headcount: department._count.employees,
      },
      today: {
        present: rows.filter((r) => r.status === 'PRESENT' || r.status === 'LATE').length,
        late: rows.filter((r) => r.status === 'LATE').length,
        absent: rows.filter((r) => r.status === 'ABSENT').length,
        onLeave: rows.filter((r) => r.status === 'ON_LEAVE').length,
        notExpected: rows.filter((r) => r.status === 'NOT_EXPECTED').length,
        needsReview: rows.filter((r) => r.status === 'NEEDS_REVIEW').length,
        live: rows.map((r) => ({
          id: r.id,
          name: r.employee.name,
          position: r.employee.position,
          arrivalAt: r.arrivalAt ? fmtTime(r.arrivalAt, ORG_TZ) : null,
          departureAt: r.departureAt ? fmtTime(r.departureAt, ORG_TZ) : null,
          netMinutes: r.netMinutes,
          status: r.status,
        })),
      },
      month: {
        month,
        attendanceRate: workingDaySet.size && presentDays
          ? Math.round((presentDays / (records.length || 1)) * 1000) / 10
          : 0,
        avgNetMinutes: netCount ? Math.round(netSum / netCount) : 0,
        avgArrival: arrivalCount ? fmtTime(new Date(Date.UTC(2026, 0, 1, 0, arrivalSum / arrivalCount)), ORG_TZ) : null,
        trend: [...perDay.entries()].sort().map(([, v]) => v),
        topLate: topLate.map((t) => ({ name: nameMap.get(t.employeeId) || t.employeeId, lates: t._count._all })),
      },
    });
  } catch (err) {
    next(err);
  }
}