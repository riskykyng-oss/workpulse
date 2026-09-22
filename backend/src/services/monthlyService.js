import { prisma } from '../config/prisma.js';
import {
  orgYmd, orgDayStart, orgToday, monthStartUTC, nextMonthStartUTC,
  workingDaysInMonth, fmtDuration, fmtTime, minuteOfDay,
} from '../utils/time.js';
import { normalizeRules } from './presenceEngine.js';
import { audit } from './auditService.js';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { PassThrough } from 'node:stream';

const ORG_TZ = 'Africa/Harare';
const SOURCE_MANUAL_INCLUDE = ['MANUALLY_SET', 'ON_LEAVE', 'NOT_EXPECTED'];

// Fields persisted on monthlySummary rows — drops derived-only counters.
function pickSummaryFields(s) {
  return {
    daysPresent: s.daysPresent,
    daysLate: s.daysLate,
    daysAbsent: s.daysAbsent,
    daysLeave: s.daysLeave,
    daysNotExpected: s.daysNotExpected,
    daysNeedsReview: s.daysNeedsReview,
    grossMinutes: s.grossMinutes,
    netMinutes: s.netMinutes,
    lunchDeductions: s.lunchDeductions,
    manualCorrections: s.manualCorrections,
  };
}

export class MonthlyService {
  async ensurePeriod(month) {
    let p = await prisma.monthlyPeriod.findUnique({ where: { month } });
    if (!p) {
      p = await prisma.monthlyPeriod.create({ data: { month } });
      // tag today's records (Sep) with the period
      const start = monthStartUTC(month, ORG_TZ);
      const end = nextMonthStartUTC(month, ORG_TZ);
      await prisma.attendanceRecord.updateMany({
        where: { date: { gte: start, lt: end }, monthlyPeriodId: null },
        data: { monthlyPeriodId: p.id },
      });
    }
    return p;
  }

  async list() {
    const periods = await prisma.monthlyPeriod.findMany({
      orderBy: { month: 'desc' },
      include: { summaries: { where: { kind: 'COMPANY' }, take: 1 } },
    });
    return Promise.all(periods.map(async (p) => {
      const comp = p.summaries[0];
      const prev = await prisma.monthlySummary.findFirst({
        where: { kind: 'COMPANY', monthlyPeriod: { month: prevMonth(p.month) } },
      });
      const needCompile = !comp || p.status === 'IN_PROGRESS';
      const totals = needCompile ? await this.companyRollup(p.month) : null;
      return {
        id: p.id,
        month: p.month,
        status: p.status,
        workingDays: p.workingDays || totals?.workingDays || 0,
        company: comp
          ? this.shapeCompanySummary(comp)
          : (totals ? this.shapeCompanyRollup(totals) : null),
        previousCompanyRate: prev?.attendanceRate ?? null,
        previousNet: prev?.netMinutes ?? null,
        compiledAt: p.compiledAt,
        closedAt: p.closedAt,
        reopenedReason: p.reopenedReason,
        flagsCount: needCompile ? await this.countFlags(p.month) : 0,
      };
    }));
  }

  async get(month) {
    const period = await this.ensurePeriod(month);
    const stored = await prisma.monthlySummary.findMany({ where: { periodicMonthId: period.id } });
    const employeeSummary = stored.length
      ? stored.filter((s) => s.kind === 'EMPLOYEE')
      : await this.employeeRollup(month);
    const departmentSummary = stored.length
      ? stored.filter((s) => s.kind === 'DEPARTMENT')
      : await this.departmentRollup(month);
    const company = stored.length
      ? stored.find((s) => s.kind === 'COMPANY')
      : await this.companyRollup(month);

    const companyShape = stored.length
      ? this.shapeCompanySummary(company)
      : this.shapeCompanyRollup(company);

    const [prevSummary, departments, flags] = await Promise.all([
      prisma.monthlySummary.findFirst({ where: { kind: 'COMPANY', monthlyPeriod: { month: prevMonth(month) } } }),
      prisma.department.findMany({ orderBy: { name: 'asc' } }),
      this.reviewFlags(month),
    ]);
    const empNameMap = new Map(
      (
        await prisma.employee.findMany({
          select: { id: true, name: true, employeeNo: true, departmentId: true },
        })
      ).map((e) => [e.id, e]),
    );

    return {
      id: period.id,
      month: period.month,
      status: period.status,
      workingDays: period.workingDays || (await this.workingDaysCount(month)),
      compiledAt: period.compiledAt,
      closedBy: period.closedBy,
      closedAt: period.closedAt,
      reopenedReason: period.reopenedReason,
      company: companyShape,
      previousCompanyRate: prevSummary?.attendanceRate ?? null,
      previousCompanyNet: prevSummary?.netMinutes ?? null,
      departments: departmentSummary.map((d) => ({
        id: d.departmentId,
        name: departments.find((x) => x.id === d.departmentId)?.name || '—',
        daysPresent: d.daysPresent,
        daysLate: d.daysLate,
        daysAbsent: d.daysAbsent,
        daysLeave: d.daysLeave,
        daysNotExpected: d.daysNotExpected,
        daysNeedsReview: d.daysNeedsReview,
        grossMinutes: d.grossMinutes,
        netMinutes: d.netMinutes,
        attendanceRate: d.attendanceRate,
      })),
      employees: employeeSummary.map((s) => {
        const emp = empNameMap.get(s.employeeId);
        return {
          employeeId: s.employeeId,
          name: emp?.name || '—',
          employeeNo: emp?.employeeNo || '—',
          departmentId: s.departmentId,
          daysPresent: s.daysPresent,
          daysLate: s.daysLate,
          daysAbsent: s.daysAbsent,
          daysLeave: s.daysLeave,
          daysNotExpected: s.daysNotExpected,
          daysNeedsReview: s.daysNeedsReview,
          workingDays: s.workingDays,
          grossMinutes: s.grossMinutes,
          netMinutes: s.netMinutes,
          lunchDeductions: s.lunchDeductions,
          manualCorrections: s.manualCorrections,
          avgArrivalMinutes: s.avgArrivalMinutes,
          avgDepartureMinutes: s.avgDepartureMinutes,
          attendanceRate:
            s.workingDays && s.daysPresent + s.daysLate + s.daysAbsent + s.daysLeave + s.daysNotExpected > 0
              ? Math.round((s.daysPresent / (s.daysPresent + s.daysLate + s.daysAbsent + s.daysLeave + s.daysNotExpected)) * 1000) / 10
              : null,
        };
      }),
      flags: flags.slice(0, 500),
    };
  }

  shapeCompanySummary(s) {
    return {
      daysPresent: s.daysPresent,
      daysLate: s.daysLate,
      daysAbsent: s.daysAbsent,
      daysLeave: s.daysLeave,
      daysNotExpected: s.daysNotExpected,
      daysNeedsReview: s.daysNeedsReview,
      grossMinutes: s.grossMinutes,
      netMinutes: s.netMinutes,
      lunchDeductions: s.lunchDeductions,
      manualCorrections: s.manualCorrections,
      workingDays: s.workingDays,
      attendanceRate: s.attendanceRate ?? this.companyRateOf(s),
    };
  }

  shapeCompanyRollup(t) {
    return {
      daysPresent: t.daysPresent,
      daysLate: t.daysLate,
      daysAbsent: t.daysAbsent,
      daysLeave: t.daysLeave,
      daysNotExpected: t.daysNotExpected,
      daysNeedsReview: t.daysNeedsReview,
      grossMinutes: t.grossMinutes,
      netMinutes: t.netMinutes,
      lunchDeductions: t.lunchDeductions,
      manualCorrections: t.manualCorrections,
      workingDays: t.workingDays,
      attendanceRate: this.companyRateOf(t),
    };
  }

  /** Attendance rate = present-days ÷ ALL scheduled slots (incl. leave & not-expected). */
  companyRateOf(t) {
    const slots = t.daysPresent + t.daysAbsent + t.daysNeedsReview + t.daysLeave + t.daysNotExpected;
    return slots ? Math.round((t.daysPresent / slots) * 1000) / 10 : 0;
  }

  async workingDaysCount(month) {
    const org = await prisma.organization.findFirst({ include: { rules: true } });
    const full = workingDaysInMonth(month, org?.workWeek || '1,2,3,4,5', ORG_TZ).length;
    const start = monthStartUTC(month, ORG_TZ);
    const today = orgToday();
    const done = workingDaysInMonth(month, org?.workWeek || '1,2,3,4,5', ORG_TZ).filter((d) => d < today).length;
    return Math.min(done, full) || full;
  }

  /**
   * The month-end job. Aggregates every employee → departments → company,
   * stores summaries, sets period to Ready for review.
   */
  async compile(month, actorName = 'System', actorId = null) {
    const period = await this.ensurePeriod(month);
    const workingDays = await this.workingDaysCount(month);

    const employeeRoll = await this.employeeRollup(month);
    const deptRoll = await this.departmentRollup(month);
    const company = await this.companyRollup(month);

    await prisma.$transaction(async (tx) => {
      await tx.monthlySummary.deleteMany({ where: { periodicMonthId: period.id } });
      for (const s of employeeRoll) {
        await tx.monthlySummary.create({ data: { periodicMonthId: period.id, kind: 'EMPLOYEE', ...s, departmentId: s.departmentId, employeeId: s.employeeId } });
      }
      for (const s of deptRoll) {
        await tx.monthlySummary.create({ data: { periodicMonthId: period.id, kind: 'DEPARTMENT', ...s } });
      }
      await tx.monthlySummary.create({
        data: {
          periodicMonthId: period.id,
          kind: 'COMPANY',
          ...pickSummaryFields(company),
          workingDays,
          attendanceRate: this.companyRateOf(company),
        },
      });
      await tx.monthlyPeriod.update({
        where: { id: period.id },
        data: {
          status: 'READY_FOR_REVIEW', compiledAt: new Date(), compiledBy: actorName, workingDays,
          companyPresentDays: company.daysPresent,
          companyNetMinutes: company.netMinutes,
          companyRate: this.companyRateOf(company),
        },
      });
    });

    await audit({
      action: 'monthly.compile',
      actorId,
      actorName,
      targetType: 'monthly_period',
      targetId: period.id,
      reason: `Auto-compiled register for ${month}`,
    });
    return this.get(month);
  }

  async close(month, actor, reason = 'Month reviewed and closed.') {
    const period = await this.ensurePeriod(month);
    if (period.status === 'CLOSED') {
      const err = new Error('This period is already closed.');
      err.status = 409;
      throw err;
    }
    const updated = await prisma.monthlyPeriod.update({
      where: { id: period.id },
      data: { status: 'CLOSED', closedBy: actor.id, closedAt: new Date() },
    });
    await audit({
      action: 'monthly.close',
      actorId: actor.id,
      actorName: actor.name,
      targetType: 'monthly_period',
      targetId: period.id,
      reason,
    });
    return updated;
  }

  async reopen(month, actor, reason) {
    if (!reason || !reason.trim()) {
      const err = new Error('A reason is required to reopen a closed month.');
      err.status = 400;
      throw err;
    }
    const period = await this.ensurePeriod(month);
    if (period.status !== 'CLOSED') {
      const err = new Error('Only a closed period can be reopened.');
      err.status = 409;
      throw err;
    }
    const updated = await prisma.monthlyPeriod.update({
      where: { id: period.id },
      data: { status: 'IN_PROGRESS', reopenedBy: actor.id, reopenedAt: new Date(), reopenedReason: reason },
    });
    await audit({
      action: 'monthly.reopen',
      actorId: actor.id,
      actorName: actor.name,
      targetType: 'monthly_period',
      targetId: period.id,
      reason,
    });
    return updated;
  }

  // -------------------------------------------------------------------------
  // Aggregations (used by both live month view and the compile job, so the
  // numbers can never disagree).
  // -------------------------------------------------------------------------

  async _recordsForMonth(month) {
    const start = monthStartUTC(month, ORG_TZ);
    const end = nextMonthStartUTC(month, ORG_TZ);
    return prisma.attendanceRecord.findMany({
      where: { date: { gte: start, lt: end } },
      include: { employee: { include: { department: true } } },
      orderBy: { date: 'asc' },
    });
  }

  async employeeRollup(month) {
    const records = await this._recordsForMonth(month);
    const correctionCounts = records.length
      ? await this._correctionCounts(records.map((r) => r.id))
      : new Map();
    const map = new Map();
    for (const r of records) {
      const key = r.employeeId;
      if (!map.has(key)) {
        map.set(key, {
          employeeId: r.employeeId,
          departmentId: r.employee.departmentId,
          daysPresent: 0, daysLate: 0, daysAbsent: 0, daysLeave: 0, daysNotExpected: 0, daysNeedsReview: 0,
          grossMinutes: 0, netMinutes: 0, lunchDeductions: 0, manualCorrections: 0,
          arrivalSum: 0, departureSum: 0, arrivalCount: 0, departureCount: 0,
          workingDays: new Set(),
        });
      }
      const a = map.get(key);
      a.workingDays.add(r.date.getTime());
      if (r.status === 'PRESENT' || r.status === 'LATE') {
        if (r.status === 'LATE') a.daysLate++;
        a.daysPresent++;
        a.grossMinutes += r.grossMinutes;
        a.netMinutes += r.netMinutes;
        a.lunchDeductions += r.lunchDeduction;
        if (r.arrivalAt) {
          a.arrivalSum += minuteOfDay(r.arrivalAt, ORG_TZ);
          a.arrivalCount++;
        }
        if (r.departureAt) {
          a.departureSum += minuteOfDay(r.departureAt, ORG_TZ);
          a.departureCount++;
        }
      } else if (r.status === 'ABSENT') a.daysAbsent++;
      else if (r.status === 'ON_LEAVE') a.daysLeave++;
      else if (r.status === 'NOT_EXPECTED') a.daysNotExpected++;
      else if (r.status === 'NEEDS_REVIEW') a.daysNeedsReview++;
      a.manualCorrections += correctionCounts.get(r.id) || 0;
    }
    const out = [];
    for (const [empId, a] of map.entries()) {
      out.push({
        employeeId: empId,
        departmentId: a.departmentId,
        daysPresent: a.daysPresent,
        daysLate: a.daysLate,
        daysAbsent: a.daysAbsent,
        daysLeave: a.daysLeave,
        daysNotExpected: a.daysNotExpected,
        daysNeedsReview: a.daysNeedsReview,
        workingDays: a.workingDays.size,
        grossMinutes: a.grossMinutes,
        netMinutes: a.netMinutes,
        lunchDeductions: a.lunchDeductions,
        manualCorrections: a.manualCorrections,
        avgArrivalMinutes: a.arrivalCount ? Math.round(a.arrivalSum / a.arrivalCount) : null,
        avgDepartureMinutes: a.departureCount ? Math.round(a.departureSum / a.departureCount) : null,
        attendanceRate: a.workingDays.size
          ? Math.round((a.daysPresent / (a.workingDays.size)) * 1000) / 10
          : null,
      });
    }
    return out;
  }

  async _correctionCounts(recordIds) {
    const rows = await prisma.attendanceCorrection.groupBy({
      by: ['attendanceRecordId'],
      _count: { _all: true },
      where: { attendanceRecordId: { in: recordIds } },
    });
    return new Map(rows.map((r) => [r.attendanceRecordId, r._count._all]));
  }

  async _correctionCount(recordId) {
    const c = await prisma.attendanceCorrection.count({ where: { attendanceRecordId: recordId } });
    return c;
  }

  async departmentRollup(month) {
    const employees = await this.employeeRollup(month);
    const dept = await prisma.department.findMany();
    const map = new Map();
    for (const d of dept) {
      map.set(d.id, {
        departmentId: d.id,
        daysPresent: 0, daysLate: 0, daysAbsent: 0, daysLeave: 0, daysNotExpected: 0, daysNeedsReview: 0,
        grossMinutes: 0, netMinutes: 0, lunchDeductions: 0, manualCorrections: 0,
        headcount: 0, workingDaysMax: 0, attendanceDays: 0,
      });
    }
    for (const e of employees) {
      const b = map.get(e.departmentId);
      if (!b) continue;
      b.headcount++;
      b.daysPresent += e.daysPresent;
      b.daysLate += e.daysLate;
      b.daysAbsent += e.daysAbsent;
      b.daysLeave += e.daysLeave;
      b.daysNotExpected += e.daysNotExpected;
      b.daysNeedsReview += e.daysNeedsReview;
      b.grossMinutes += e.grossMinutes;
      b.netMinutes += e.netMinutes;
      b.lunchDeductions += e.lunchDeductions;
      b.manualCorrections += e.manualCorrections;
      b.workingDaysMax = Math.max(b.workingDaysMax, e.workingDays);
      b.attendanceDays += e.workingDays;
    }
    return [...map.values()].map((b) => ({
      departmentId: b.departmentId,
      daysPresent: b.daysPresent,
      daysLate: b.daysLate,
      daysAbsent: b.daysAbsent,
      daysLeave: b.daysLeave,
      daysNotExpected: b.daysNotExpected,
      daysNeedsReview: b.daysNeedsReview,
      grossMinutes: b.grossMinutes,
      netMinutes: b.netMinutes,
      lunchDeductions: b.lunchDeductions,
      manualCorrections: b.manualCorrections,
      workingDays: b.workingDaysMax,
      attendanceRate: b.attendanceDays ? Math.round((b.daysPresent / b.attendanceDays) * 1000) / 10 : 0,
    }));
  }

  async companyRollup(month) {
    const employees = await this.employeeRollup(month);
    const company = employees.reduce(
      (acc, e) => {
        acc.daysPresent += e.daysPresent;
        acc.daysLate += e.daysLate;
        acc.daysAbsent += e.daysAbsent;
        acc.daysLeave += e.daysLeave;
        acc.daysNotExpected += e.daysNotExpected;
        acc.daysNeedsReview += e.daysNeedsReview;
        acc.grossMinutes += e.grossMinutes;
        acc.netMinutes += e.netMinutes;
        acc.lunchDeductions += e.lunchDeductions;
        acc.manualCorrections += e.manualCorrections;
        acc.attendanceDays += e.workingDays;
        return acc;
      },
      {
        daysPresent: 0, daysLate: 0, daysAbsent: 0, daysLeave: 0, daysNotExpected: 0, daysNeedsReview: 0,
        grossMinutes: 0, netMinutes: 0, lunchDeductions: 0, manualCorrections: 0,
        attendanceDays: 0, workingDays: 0,
      },
    );
    return company;
  }

  async reviewFlags(month) {
    const start = monthStartUTC(month, ORG_TZ);
    const end = nextMonthStartUTC(month, ORG_TZ);
    const flagged = await prisma.attendanceRecord.findMany({
      where: { date: { gte: start, lt: end }, needsReview: true },
      include: { employee: { include: { department: true } }, corrections: { take: 1 } },
    });
    const absents = await prisma.attendanceRecord.findMany({
      where: { date: { gte: start, lt: end }, status: 'ABSENT', needsReview: false },
      include: { employee: { include: { department: true } } },
    });
    const late = await prisma.attendanceRecord.findMany({
      where: { date: { gte: start, lt: end }, status: 'LATE' },
      include: { employee: { include: { department: true } } },
    });
    const flags = [];
    for (const r of flagged) {
      flags.push({
        type: r.exceptionReason || 'NEEDS_REVIEW',
        recordId: r.id,
        employeeId: r.employeeId,
        employeeName: r.employee.name,
        departmentName: r.employee.department.name,
        date: r.date,
        note: r.exceptionNote || `Open ${r.status.toLowerCase()} needing resolution.`,
      });
    }
    for (const r of absents) {
      flags.push({
        type: 'UNRESOLVED_ABSENT',
        recordId: r.id,
        employeeId: r.employeeId,
        employeeName: r.employee.name,
        departmentName: r.employee.department.name,
        date: r.date,
        note: 'Absence with no recorded reason or correction.',
      });
    }
    for (const r of late) {
      flags.push({
        type: 'LATE',
        recordId: r.id,
        employeeId: r.employeeId,
        employeeName: r.employee.name,
        departmentName: r.employee.department.name,
        date: r.date,
        note: `Arrived ${r.lateMinutes} minutes after 08:10.`,
      });
    }
    return flags.sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  async countFlags(month) {
    return (await this.reviewFlags(month)).length;
  }

  // -------------------------------------------------------------------------
  // Exports
  // -------------------------------------------------------------------------

  async exportCsv(month) {
    const data = await this.get(month);
    const rows = [];
    rows.push(['Monthly Attendance Register — ' + month, '', '', '', '', '', '', '', '', '']);
    rows.push([]);
    rows.push(['Employee', 'Department', 'Present', 'Late', 'Absent', 'On leave', 'Not expected', 'Net hours', 'Avg arrival', 'Avg departure']);
    const employees = await prisma.employee.findMany({ include: { department: true } });
    const deptName = new Map(employees.map((e) => [e.id, e.department.name]));
    for (const e of data.employees) {
      rows.push([
        e.name,
        deptName.get(e.employeeId) || '',
        e.daysPresent, e.daysLate, e.daysAbsent, e.daysLeave, e.daysNotExpected,
        this._hours(e.netMinutes),
        e.avgArrivalMinutes != null ? this._minToTime(e.avgArrivalMinutes) : '',
        e.avgDepartureMinutes != null ? this._minToTime(e.avgDepartureMinutes) : '',
      ]);
    }
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    return rows.map((r) => r.map(esc).join(',')).join('\n');
  }

  async exportXlsx(month) {
    const data = await this.get(month);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(`Register ${month}`);
    ws.columns = [
      { header: 'Department', key: 'dept', width: 20 },
      { header: 'Present', key: 'present', width: 10 },
      { header: 'Late', key: 'late', width: 8 },
      { header: 'Absent', key: 'absent', width: 8 },
      { header: 'On leave', key: 'leave', width: 8 },
      { header: 'Not expected', key: 'notExpected', width: 12 },
      { header: 'Net hours', key: 'net', width: 12 },
      { header: 'Attendance rate', key: 'rate', width: 14 },
    ];
    for (const d of data.departments) {
      ws.addRow({ dept: d.name, present: d.daysPresent, late: d.daysLate, absent: d.daysAbsent, leave: d.daysLeave, notExpected: d.daysNotExpected, net: this._hours(d.netMinutes), rate: d.attendanceRate });
    }
    ws.addRow({});
    const ws2 = wb.addWorksheet(`Per employee ${month}`);
    ws2.columns = [
      { header: 'Employee', key: 'name', width: 24 }, { header: 'Present', key: 'present', width: 9 },
      { header: 'Late', key: 'late', width: 8 }, { header: 'Absent', key: 'absent', width: 8 },
      { header: 'Leave', key: 'leave', width: 8 }, { header: 'Net hours', key: 'net', width: 12 },
      { header: 'Avg arrival', key: 'arr', width: 10 }, { header: 'Avg departure', key: 'dep', width: 12 },
      { header: 'Corrections', key: 'corr', width: 12 },
    ];
    for (const e of data.employees) {
      ws2.addRow({
        name: e.name, present: e.daysPresent, late: e.daysLate,
        absent: e.daysAbsent, leave: e.daysLeave, net: this._hours(e.netMinutes),
        arr: e.avgArrivalMinutes != null ? this._minToTime(e.avgArrivalMinutes) : '',
        dep: e.avgDepartureMinutes != null ? this._minToTime(e.avgDepartureMinutes) : '',
        corr: e.manualCorrections,
      });
    }
    return wb.xlsx.writeBuffer();
  }

  async exportPdf(month) {
    const data = await this.get(month);
    const doc = new PDFDocument({ size: 'A4', margin: 36 });
    const out = new PassThrough();
    const chunks = [];
    out.on('data', (c) => chunks.push(c));

    doc.fontSize(18).text(`Monthly Attendance Register — ${month}`, { align: 'center' });
    doc.moveDown();
    doc.fontSize(11).text(`Company attendance rate: ${data.company.attendanceRate}%`);
    doc.text(`Total net hours: ${this._hours(data.company.netMinutes)}`);
    doc.text(`Present days: ${data.company.daysPresent} · Late: ${data.company.daysLate} · Absent: ${data.company.daysAbsent}`);
    doc.moveDown();

    for (const d of data.departments) {
      doc.fontSize(13).text(d.name, { underline: true });
      doc.fontSize(10).text(`Present ${d.daysPresent} · Late ${d.daysLate} · Absent ${d.daysAbsent} · Net ${this._hours(d.netMinutes)} · Rate ${d.attendanceRate}%`);
      doc.moveDown(0.4);
    }

    doc.pipe(out);
    await new Promise((resolve, reject) => {
      out.on('finish', resolve);
      doc.on('error', reject);
      doc.end();
    });
    return Buffer.concat(chunks);
  }

  _hours(min) {
    return fmtDuration(min);
  }

  _minToTime(min) {
    return fmtTime(new Date(Date.UTC(2026, 0, 1, Math.floor(min / 60), min % 60)), 'Africa/Harare');
  }
}

const _monthNames = {};

export function prevMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export const monthlyService = new MonthlyService();