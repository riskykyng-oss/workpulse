import { prisma } from '../config/prisma.js';
import { presenceService } from '../services/presenceService.js';
import { attendanceService } from '../services/attendanceService.js';
import { managerScope } from '../middleware/auth.js';

/** Composite payload for the HR dashboard. */
export async function dashboard(req, res, next) {
  try {
    const scope = managerScope(req);
    const totals = await presenceService.computeTotals();
    const live = await attendanceService.getLive(new Date());
    const exceptions = await attendanceService.getExceptions();
    const departments = await prisma.department.findMany({
      where: scope ? { id: scope.departmentId } : undefined,
      include: {
        _count: { select: { employees: true } },
      },
      orderBy: { name: 'asc' },
    });

    const ownDeptName = scope ? departments[0]?.name : null;

    // Managers see company figures collapsed to their own department.
    const byDeptTotals = new Map(totals.byDepartment.map((d) => [d.id, d]));
    const scopedTotal = scope ? byDeptTotals.get(scope.departmentId) : null;
    const totalsOut = scope
      ? {
          at: totals.at,
          headcount: scopedTotal?.total || 0,
          present: scopedTotal?.present || 0,
          late: scopedTotal?.late || 0,
          absent: scopedTotal?.absent || 0,
          onLeave: scopedTotal?.onLeave || 0,
          notExpected: scopedTotal?.notExpected || 0,
          needsReview: scopedTotal?.needsReview || 0,
          attendanceRate: scopedTotal?.total ? Math.round((scopedTotal.present / scopedTotal.total) * 1000) / 10 : 0,
          byDepartment: scopedTotal ? [scopedTotal] : [],
        }
      : totals;

    const deptCards = departments.map((d) => {
      const t = byDeptTotals.get(d.id) || { total: 0, present: 0, late: 0, absent: 0, onLeave: 0, notExpected: 0, needsReview: 0 };
      return {
        id: d.id,
        name: d.name,
        manager: null,
        headcount: d._count.employees,
        ...t,
        attendanceRate: t.total ? Math.round((t.present / t.total) * 1000) / 10 : 0,
      };
    });

    // Live feed: the day's arrivals/departures, newest first.
    const feed = [];
    for (const r of live.records) {
      if (scope && r.employee.department.id !== scope.departmentId) continue;
      if (r.status === 'PRESENT' || r.status === 'LATE') {
        feed.push({
          id: `${r.id}-in`,
          kind: 'checked-in',
          at: r.arrivalAt,
          employeeName: r.employee.name,
          department: r.employee.department.name,
          isLate: r.status === 'LATE',
        });
      }
      if (r.departureAt) {
        feed.push({
          id: `${r.id}-out`,
          kind: 'checked-out',
          at: r.departureAt,
          employeeName: r.employee.name,
          department: r.employee.department.name,
        });
      }
    }
    feed.sort((a, b) => new Date(b.at) - new Date(a.at));

    const scopedExceptions = scope
      ? exceptions.filter((e) => e.departmentName === ownDeptName)
      : exceptions;

    res.json({
      totals: totalsOut,
      departments: deptCards,
      feed: feed.slice(0, 40),
      exceptions: scopedExceptions.slice(0, 20),
      exceptionCount: scopedExceptions.length,
    });
  } catch (err) {
    next(err);
  }
}