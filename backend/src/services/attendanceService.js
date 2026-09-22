import { prisma } from '../config/prisma.js';
import { orgYmd, orgDayStart, minuteOfDay, orgToday } from '../utils/time.js';
import { normalizeRules, evaluateDay } from './presenceEngine.js';
import { audit } from './auditService.js';

const ORG_TZ = 'Africa/Harare';

/** Projection used everywhere the register is rendered. */
const recordInclude = {
  employee: {
    include: {
      department: true,
      devices: { where: { status: 'ACTIVE' }, orderBy: { isPrimary: 'desc' }, take: 3 },
      user: { select: { id: true, email: true } },
    },
  },
  corrections: { orderBy: { createdAt: 'desc' }, take: 5 },
};

export class AttendanceService {
  /**
   * The live register for a date, grouped/sorted by department.
   */
  async getLive(date) {
    const day = !process.env.DEMO_TODAY_YMD && date instanceof Date
      ? orgDayStart(orgYmd(date, ORG_TZ), ORG_TZ)
      : orgToday();
    const records = await prisma.attendanceRecord.findMany({
      where: { date: day },
      include: recordInclude,
      orderBy: [{ employee: { department: { name: 'asc' } } }, { employee: { name: 'asc' } }],
    });
    return { date: day.toISOString(), records: records.map((r) => this.decorate(r)) };
  }

  async getHistory({ employeeId, from, to, departmentId }) {
    const where = { date: { gte: from, lte: to } };
    if (employeeId) where.employeeId = employeeId;
    if (departmentId) where.employee = { departmentId };
    const records = await prisma.attendanceRecord.findMany({ where, include: recordInclude, orderBy: { date: 'desc' } });
    return records.map((r) => this.decorate(r));
  }

  async getByEmployee(employeeId, limit = 35) {
    const records = await prisma.attendanceRecord.findMany({
      where: { employeeId },
      include: recordInclude,
      orderBy: { date: 'desc' },
      take: limit,
    });
    return records.map((r) => this.decorate(r));
  }

  /** Row shaping shared by every listing endpoint. */
  decorate(r) {
    const onSite = r.status === 'PRESENT' || r.status === 'LATE' || r.status === 'NEEDS_REVIEW';
    return {
      id: r.id,
      date: r.date,
      status: r.status,
      exceptionReason: r.exceptionReason,
      needsReview: r.needsReview,
      arrivalAt: r.arrivalAt,
      departureAt: r.departureAt,
      grossMinutes: r.grossMinutes,
      lunchDeduction: r.lunchDeduction,
      netMinutes: r.netMinutes,
      lateMinutes: r.lateMinutes,
      source: r.source,
      onSite: onSite && !r.departureAt,
      employee: {
        id: r.employee.id,
        name: r.employee.name,
        firstName: r.employee.firstName,
        lastName: r.employee.lastName,
        employeeNo: r.employee.employeeNo,
        position: r.employee.position,
        employmentType: r.employee.employmentType,
        email: r.employee.email,
        department: { id: r.employee.department.id, name: r.employee.department.name },
        devices: r.employee.devices.map((d) => ({ id: d.id, name: d.name, type: d.type, os: d.os, isPrimary: d.isPrimary, lastSeenAt: d.lastSeenAt, status: d.status })),
      },
      corrections: r.corrections.map((c) => ({
        id: c.id, reason: c.reason, actorName: c.actorName, createdAt: c.createdAt,
        old: c.oldValue, next: c.newValue,
      })),
    };
  }

  /**
   * Evidence chain for the "Why is this person marked present?" drawer.
   */
  async getEvidence(recordId) {
    const record = await prisma.attendanceRecord.findUnique({
      where: { id: recordId },
      include: {
        employee: { include: { department: true, devices: { where: { status: 'ACTIVE' } } } },
        corrections: { orderBy: { createdAt: 'asc' }, take: 10 },
      },
    });
    if (!record) return null;

    const day = record.date;
    const [events, session, rules] = await Promise.all([
      prisma.networkEvent.findMany({
        where: { employeeId: record.employeeId, timestamp: { gte: day, lt: new Date(day.getTime() + 86400000) } },
        orderBy: { timestamp: 'asc' },
      }),
      prisma.presenceSession.findUnique({ where: { employeeId_date: { employeeId: record.employeeId, date: day } } }),
      prisma.attendanceRules.findUnique({ where: { id: 1 } }),
    ]);

    const rr = normalizeRules(rules);
    const evaluated = evaluateDay({
      events,
      rules: rr,
      now: record.departureAt ? record.departureAt.getTime() : Date.now(),
      timeZone: ORG_TZ,
    });

    return {
      record: this.decorate(record),
      evidence: session?.evidence || null,
      evaluated: {
        arrival: evaluated.arrival,
        arrivalConfirmed: evaluated.arrivalConfirmed,
        departure: evaluated.departure,
        onSite: evaluated.onSite,
        grossMinutes: evaluated.grossMinutes,
        lunchDetected: evaluated.lunchDetected,
        lunchDeduction: evaluated.lunchDeduction,
        lunchMode: evaluated.lunchMode,
        netMinutes: evaluated.netMinutes,
        lateMinutes: evaluated.lateMinutes,
        segments: evaluated.segments,
        gaps: evaluated.gaps,
      },
      rules: {
        workStartMinutes: rr.workStartMinutes,
        workEndMinutes: rr.workEndMinutes,
        lateThresholdMinutes: rr.lateThresholdMinutes,
        confirmationWindowMinutes: rr.confirmationWindowMinutes,
        disconnectBridgeMinutes: rr.disconnectBridgeMinutes,
        departureGraceMinutes: rr.departureGraceMinutes,
        lunchStartMinutes: rr.lunchStartMinutes,
        lunchEndMinutes: rr.lunchEndMinutes,
        lunchMode: rr.lunchMode,
        lunchMinMinutes: rr.lunchMinMinutes,
        lunchMaxMinutes: rr.lunchMaxMinutes,
        lunchFixedMinutes: rr.lunchFixedMinutes,
      },
      timeline: events.map((e) => ({
        eventType: e.eventType,
        at: e.timestamp,
        network: e.networkName,
        deviceName: /** @type {any} */ (e).device?.name,
        rawDeviceId: e.rawDeviceId,
      })),
    };
  }

  /**
   * Exceptions queue for "today". Built from raw fact, never guessed.
   */
  async getExceptions() {
    const day = orgToday();
    const next = new Date(day.getTime() + 86400000);
    const items = [];

    // 1. Unknown devices sighted on authorised networks.
    const unknown = await prisma.networkEvent.findMany({
      where: { deviceId: null, timestamp: { gte: day, lt: next } },
      orderBy: { timestamp: 'desc' },
    });
    const grouped = new Map();
    for (const e of unknown) {
      const k = e.rawDeviceId;
      if (!grouped.has(k)) grouped.set(k, { count: 0, firstSeen: e.timestamp, lastSeen: e.timestamp, networkName: e.networkName });
      const g = grouped.get(k);
      g.count++;
      g.firstSeen = new Date(Math.min(g.firstSeen, e.timestamp));
      g.lastSeen = new Date(Math.max(g.lastSeen, e.timestamp));
    }
    for (const [rawDeviceId, g] of grouped.entries()) {
      items.push({
        id: `ud-${rawDeviceId}`,
        type: 'UNKNOWN_DEVICE',
        title: 'Unregistered device on the network',
        note: `Raw id ${rawDeviceId.slice(0, 18)}… seen ${g.count}× on ${g.networkName} at ${g.lastSeen.toISOString()}`,
        severity: 'high',
        employeeId: null,
        at: g.lastSeen,
      });
    }

    // 2. Every flagged needs-review attendance record today.
    const flagged = await prisma.attendanceRecord.findMany({
      where: { date: day, needsReview: true },
      include: { employee: { include: { department: true } } },
    });
    for (const f of flagged) {
      items.push({
        id: `flag-${f.id}`,
        type: f.exceptionReason || 'ODD_TIMING',
        title: `${f.employee.name} — ${reasonLabel(f.exceptionReason)}`,
        note: f.exceptionNote || `Status is ${f.status} and needs your review before the month compiles.`,
        severity: f.status === 'NEEDS_REVIEW' ? 'high' : 'medium',
        employeeId: f.employeeId,
        departmentId: f.employee.departmentId,
        departmentName: f.employee.department.name,
        at: f.updatedAt,
      });
    }

    // 3. Employees still on-site long after the workday (device never left).
    const [rules] = await Promise.all([prisma.attendanceRules.findUnique({ where: { id: 1 } })]);
    const rr = normalizeRules(rules);
    const now = new Date();
    if (minuteOfDay(now, ORG_TZ) > rr.workEndMinutes + 120) {
      const lingering = await prisma.presenceSession.findMany({
        where: { date: day, state: { in: ['PRESENT', 'LATE'] }, departureAt: null },
        include: { employee: { include: { department: true } } },
      });
      for (const l of lingering) {
        items.push({
          id: `linger-${l.id}`,
          type: 'DEVICE_NEVER_LEAVE',
          title: `Device never left — ${l.employee.name}`,
          note: `${l.employee.name} (${l.employee.department.name}) was still on-site past ${time(rr.workEndMinutes + 120)}.`,
          severity: 'medium',
          employeeId: l.employeeId,
          departmentName: l.employee.department.name,
          at: now,
        });
      }
    }

    // 4. Absents not yet resolved (informational for the review panel).
    const absents = await prisma.attendanceRecord.findMany({
      where: { date: day, status: 'ABSENT' },
      include: { employee: { include: { department: true } } },
    });
    for (const a of absents) {
      items.push({
        id: `absent-${a.id}`,
        type: 'UNRESOLVED_ABSENT',
        title: `${a.employee.name} absent`,
        note: `No correction recorded yet. Absences stay open until the register is reviewed.`,
        severity: 'medium',
        employeeId: a.employeeId,
        departmentName: a.employee.department.name,
        at: a.updatedAt,
      });
    }

    items.sort((a, b) => new Date(b.at) - new Date(a.at));
    return items;
  }

  /**
   * HR correction. Requires a reason, writes an audit entry in the same
   * transaction, and refuses to touch a closed period unless re-opened.
   */
  async correct({ recordId, changes, reason, actor }) {
    if (!reason || !reason.trim()) {
      const err = new Error('A reason is required for corrections.');
      err.status = 400;
      throw err;
    }

    const record = await prisma.attendanceRecord.findUnique({ where: { id: recordId }, include: { monthlyPeriod: true } });
    if (!record) {
      const err = new Error('Attendance record not found.');
      err.status = 404;
      throw err;
    }
    if (record.monthlyPeriod?.status === 'CLOSED') {
      const err = new Error('This period is closed. Reopen the month before correcting attendance.');
      err.status = 409;
      throw err;
    }

    const oldValue = {
      status: record.status, arrivalAt: record.arrivalAt, departureAt: record.departureAt,
      netMinutes: record.netMinutes, lunchDeduction: record.lunchDeduction, lateMinutes: record.lateMinutes,
    };
    const newValue = { ...oldValue, ...changes };

    await prisma.$transaction(async (tx) => {
      const up = await tx.attendanceRecord.update({
        where: { id: recordId },
        data: {
          status: newValue.status,
          arrivalAt: newValue.arrivalAt ?? null,
          departureAt: newValue.departureAt ?? null,
          netMinutes: newValue.netMinutes ?? 0,
          lunchDeduction: newValue.lunchDeduction ?? 0,
          lateMinutes: newValue.lateMinutes ?? 0,
          needsReview: false,
          exceptionReason: null,
          source: 'manual',
        },
      });
      await tx.attendanceCorrection.create({
        data: {
          attendanceRecordId: recordId,
          oldValue,
          newValue,
          reason,
          actorId: actor.id,
          actorName: actor.name,
        },
      });
      return up;
    });

    await audit({
      action: 'attendance.correct',
      actorId: actor.id,
      actorName: actor.name,
      targetType: 'attendance',
      targetId: recordId,
      reason,
      detail: { oldValue, newValue },
    });

    return this.decorate(await prisma.attendanceRecord.findUnique({ where: { id: recordId }, include: recordInclude }));
  }
}

function reasonLabel(reason) {
  const map = {
    UNKNOWN_DEVICE: 'Unknown device',
    DATA_GAP: 'Data gap',
    DEVICE_NEVER_LEAVE: 'Device never left',
    ODD_TIMING: 'Odd timing',
    UNRESOLVED_LATE: 'Unresolved late',
    UNRESOLVED_ABSENT: 'Unresolved absence',
  };
  return map[reason] || reason || 'Needs review';
}

function time(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export const attendanceService = new AttendanceService();