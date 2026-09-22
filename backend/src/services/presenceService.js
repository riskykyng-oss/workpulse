import { prisma } from '../config/prisma.js';
import { normalizeRules, evaluateDay, decideStatus, liveNetMinutes } from './presenceEngine.js';
import { orgYmd, orgDayStart, fmtTime, orgToday } from '../utils/time.js';
import { notificationService } from './notificationService.js';
import { audit } from './auditService.js';

const ORG_TZ = 'Africa/Harare';

/**
 * Presence service — the pipeline core. All attendance logic lives here on the
 * server:
 *
 *   Detection → device match → confirmation (engine) → arrival recorded → ping
 *
 * Every employee-day is re-evaluated from its full event log (no incremental
 * state that could drift), so a rule change or an outage simply re-runs the
 * pure engine and persists the result — the browser never computes anything.
 */
export class PresenceService {
  /**
   * Entry point for the detection adapter: one connect/disconnect.
   * @param {{ rawDeviceId: string, networkName: string, eventType: 'CONNECT'|'DISCONNECT', timestamp: Date|number, adapterSource?: string }} d
   */
  async handleDetection(d) {
    const timestamp = d.timestamp instanceof Date ? d.timestamp : new Date(d.timestamp);
    const adapterSource = d.adapterSource || 'mock';

    // Match the raw id to a registered device. We never assume it is a MAC.
    const device = await prisma.device.findUnique({ where: { identifier: d.rawDeviceId } });

    if (!device) {
      const record = await prisma.networkEvent.create({
        data: {
          rawDeviceId: d.rawDeviceId,
          networkName: d.networkName,
          eventType: d.eventType,
          timestamp,
          adapterSource,
        },
      });
      await notificationService.exception({
        employee: null,
        department: null,
        reason: 'UNKNOWN_DEVICE',
        note: `Unregistered device ${d.rawDeviceId} seen on ${d.networkName} at ${orgTime(timestamp)}`,
      });
      await this.refreshTotals();
      return { kind: 'unknown_device', eventId: record.id };
    }

    const event = await prisma.networkEvent.create({
      data: {
        deviceId: device.id,
        employeeId: device.employeeId,
        rawDeviceId: d.rawDeviceId,
        networkName: d.networkName,
        eventType: d.eventType,
        timestamp,
        adapterSource,
      },
    });

    await prisma.device.update({
      where: { id: device.id },
      data: { lastSeenAt: timestamp },
    });

    const result = await this.recomputeEmployeeDay(device.employeeId, timestamp);

    if (event.eventType === 'CONNECT') {
      await prisma.device.update({ where: { id: device.id }, data: { isPrimary: true } });
    }

    return { kind: 'processed', eventId: event.id, ...result };
  }

  /**
   * Re-evaluate one employee-day from its full event log and persist
   * presence session + attendance record. Emits the right pings.
   *
   * @param {string} employeeId
   * @param {string|number|Date} onDate instant within the working day
   */
  async recomputeEmployeeDay(employeeId, onDate) {
    const ts = new Date(onDate);
    const day = orgDayStart(orgYmd(ts, ORG_TZ), ORG_TZ);

    const [employee, existing, allRules, events] = await Promise.all([
      prisma.employee.findUnique({
        where: { id: employeeId },
        include: { department: { include: { organization: true } } },
      }),
      prisma.attendanceRecord.findUnique({
        where: { employeeId_date: { employeeId, date: day } },
      }),
      prisma.attendanceRules.findUnique({ where: { id: 1 } }),
      prisma.networkEvent.findMany({
        where: { employeeId, timestamp: { gte: day, lt: new Date(day.getTime() + 86400000) } },
        orderBy: { timestamp: 'asc' },
        include: { device: { select: { id: true, name: true, type: true, os: true, identifier: true } } },
      }),
    ]);

    const rules = normalizeRules(allRules);
    const now = Date.now();
    const evaluated = evaluateDay({ events, rules, now, timeZone: ORG_TZ });

    // Preserve seeded/manual statuses that override the event stream
    // (ON_LEAVE / NOT_EXPECTED / MANUALLY_SET).
    const preserved = existing && ['ON_LEAVE', 'NOT_EXPECTED', 'MANUALLY_SET'].includes(existing.status)
      ? { status: existing.status, needsReview: existing.needsReview, exceptionReason: existing.exceptionReason }
      : null;

    const decision = preserved
      ? { status: preserved.status, reason: preserved.exceptionReason, needsReview: preserved.needsReview }
      : decideStatus({ evaluated, rules, now, timeZone: ORG_TZ, meta: {} });

    const prev = existing;
    const recordInput = {
      employeeId,
      date: day,
      status: decision.status,
      arrivalAt: evaluated.arrival,
      departureAt: evaluated.departure,
      grossMinutes: evaluated.grossMinutes,
      lunchDeduction: evaluated.lunchDeduction,
      netMinutes: evaluated.netMinutes,
      lateMinutes: evaluated.lateMinutes,
      exceptionReason: decision.reason || null,
      needsReview: decision.needsReview || false,
      source: 'auto',
    };

    const record = await prisma.attendanceRecord.upsert({
      where: { employeeId_date: { employeeId, date: day } },
      update: recordInput,
      create: recordInput,
    });

    const evidence = {
      device: events.length ? {
        name: events[0].device?.name || 'device',
        os: events[0].device?.os,
        type: events[0].device?.type,
        identifierStrategy: 'companion-uuid',
      } : null,
      network: events.length ? events[0].networkName : null,
      firstSeen: events.length ? events[0].timestamp : null,
      confirmationWindowMinutes: rules.confirmationWindowMinutes,
      confirmedAt: evaluated.arrivalConfirmed ? evaluated.arrival : null,
      segments: evaluated.segments,
      gaps: evaluated.gaps,
      lunchDetected: evaluated.lunchDetected,
      rules: rules,
    };

    await prisma.presenceSession.upsert({
      where: { employeeId_date: { employeeId, date: day } },
      update: {
        arrivalAt: evaluated.arrival,
        confirmedAt: evaluated.arrivalConfirmed ? evaluated.arrival : null,
        departureAt: evaluated.departure,
        lastSeenAt: evaluated.onSite ? new Date(now) : evaluated.departure,
        grossMinutes: evaluated.grossMinutes,
        lunchDeduction: evaluated.lunchDeduction,
        lunchDetected: evaluated.lunchDetected,
        netMinutes: evaluated.netMinutes,
        state: sessionState(decision.status),
        reason: decision.reason,
        evidence,
      },
      create: {
        employeeId,
        date: day,
        arrivalAt: evaluated.arrival,
        confirmedAt: evaluated.arrivalConfirmed ? evaluated.arrival : null,
        departureAt: evaluated.departure,
        lastSeenAt: evaluated.onSite ? new Date(now) : evaluated.departure,
        grossMinutes: evaluated.grossMinutes,
        lunchDeduction: evaluated.lunchDeduction,
        lunchDetected: evaluated.lunchDetected,
        netMinutes: evaluated.netMinutes,
        state: sessionState(decision.status),
        reason: decision.reason,
        evidence,
      },
    });

    this.emitTransitions({ prev, next: record, employee, evaluated });

    if (decision.needsReview || decision.reason) {
      await notificationService.exception({
        employee,
        department: employee.department,
        reason: decision.reason,
        note: `${employee.name} needs review today (${decision.reason}).`,
      });
    }

    await this.refreshTotals();
    return { recordId: record.id, status: decision.status, evaluated };
  }

  emitTransitions({ prev, next, employee, evaluated }) {
    const wasArrived = prev && ['PRESENT', 'LATE', 'NEEDS_REVIEW'].includes(prev.status);
    const isArrived = ['PRESENT', 'LATE'].includes(next.status);

    if (!wasArrived && isArrived) {
      notificationService.arrival({
        employee,
        department: employee.department,
        arrivedAt: next.arrivalAt,
        lateMinutes: next.lateMinutes,
        isLate: next.status === 'LATE',
      });
    }
    if (!prev?.departureAt && next.departureAt) {
      notificationService.departure({
        employee,
        department: employee.department,
        departureAt: next.departureAt,
      });
    }
    void evaluated;
  }

  /**
   * Toggle a network feed outage. On: everyone with a confirmed presence today
   * becomes Needs review (Data gap) — never Absent. Off: everything re-computes.
   * @param {boolean} on
   * @param {string} [actor]
   */
  async setOutage(on, actor = 'System') {
    await audit({
      action: on ? 'network.outage_started' : 'network.outage_recovered',
      actorName: actor,
      targetType: 'network',
      reason: 'Simulated network feed outage',
    });

    if (on) {
      const day = orgToday();
      const affected = await prisma.attendanceRecord.findMany({
        where: { date: day, status: { in: ['PRESENT', 'LATE'] } },
        include: { employee: { include: { department: true } } },
      });
      for (const rec of affected) {
        await prisma.attendanceRecord.update({
          where: { id: rec.id },
          data: { status: 'NEEDS_REVIEW', exceptionReason: 'DATA_GAP', needsReview: true },
        });
        await notificationService.exception({
          employee: rec.employee,
          department: rec.employee.department,
          reason: 'DATA_GAP',
          note: `Network feed down — ${rec.employee.name}'s presence cannot be verified.`,
        });
      }
    } else {
      // Recompute every employee who touched the network today — engine restores
      // the correct status from the event log.
      const day = orgToday();
      const sessionEmp = await prisma.networkEvent.findMany({
        where: { timestamp: { gte: day, lt: new Date(day.getTime() + 86400000) }, employeeId: { not: null } },
        select: { employeeId: true },
        distinct: ['employeeId'],
      });
      for (const row of sessionEmp) {
        await this.recomputeEmployeeDay(row.employeeId, orgToday());
      }
    }
    await this.refreshTotals();
  }

  /**
   * Called after every material change: re-publishes today's counters and the
   * department bars for all connected clients.
   */
  async refreshTotals() {
    const totals = await this.computeTotals();
    notificationService.totals(totals);
    return totals;
  }

  /** Company + per-department counts for "today". */
  async computeTotals(date) {
    const day = date ?? orgToday();
    const records = await prisma.attendanceRecord.findMany({
      where: { date: day },
      include: { employee: { include: { department: true } } },
    });

    const count = {};
    for (const r of records) count[r.status] = (count[r.status] || 0) + 1;

    const headcount = records.length;

    const byDept = new Map();
    for (const r of records) {
      const d = r.employee.department;
      if (!byDept.has(d.id)) {
        byDept.set(d.id, {
          id: d.id,
          name: d.name,
          total: 0, present: 0, late: 0, absent: 0, onLeave: 0, notExpected: 0, needsReview: 0,
        });
      }
      const b = byDept.get(d.id);
      b.total++;
      if (r.status === 'PRESENT' || r.status === 'LATE') { b.present++; if (r.status === 'LATE') b.late++; }
      else if (r.status === 'ABSENT') b.absent++;
      else if (r.status === 'ON_LEAVE') b.onLeave++;
      else if (r.status === 'NOT_EXPECTED') b.notExpected++;
      else if (r.status === 'NEEDS_REVIEW') b.needsReview++;
    }

    const present = (count.PRESENT || 0) + (count.LATE || 0);
    const late = count.LATE || 0;
    const absent = count.ABSENT || 0;
    const onLeave = count.ON_LEAVE || 0;
    const notExpected = count.NOT_EXPECTED || 0;
    const needsReview = count.NEEDS_REVIEW || 0;

    return {
      at: new Date().toISOString(),
      headcount,
      present,
      late,
      absent,
      onLeave,
      notExpected,
      needsReview,
      attendanceRate: headcount ? Math.round((present / headcount) * 1000) / 10 : 0,
      byDepartment: [...byDept.values()].sort((a, b) => b.total - a.total),
    };
  }

  /**
   * Live running net-hours for every currently on-site employee, published
   * every minute so the counters update without any page refresh.
   */
  async liveTick() {
    const day = orgToday();
    const [rules, sessions] = await Promise.all([
      prisma.attendanceRules.findUnique({ where: { id: 1 } }),
      prisma.presenceSession.findMany({
        where: { date: day, state: { in: ['PRESENT', 'LATE', 'DETECTED'] } },
        include: { employee: { include: { department: true } } },
      }),
    ]);
    const rr = normalizeRules(rules);
    const now = Date.now();
    const entries = [];
    for (const s of sessions) {
      if (!s.arrivalAt) continue;
      let net;
      try {
        const events = await prisma.networkEvent.findMany({
          where: { employeeId: s.employeeId, timestamp: { gte: day, lt: new Date(day.getTime() + 86400000) } },
          orderBy: { timestamp: 'asc' },
        });
        const evaluated = evaluateDay({ events, rules: rr, now, timeZone: ORG_TZ });
        net = liveNetMinutes(evaluated, rr, now, ORG_TZ);
      } catch {
        net = s.netMinutes;
      }
      entries.push({ employeeId: s.employeeId, netMinutes: net });
    }
    if (entries.length) notificationService.live(entries);
    return entries;
  }
}

function sessionState(status) {
  const map = { PRESENT: 'PRESENT', LATE: 'LATE', ABSENT: 'ABSENT', ON_LEAVE: 'ON_LEAVE', NOT_EXPECTED: 'NOT_EXPECTED', NEEDS_REVIEW: 'NEEDS_REVIEW', MANUALLY_SET: 'MANUALLY_SET', DETECTED: 'DETECTED' };
  return map[status] || 'DETECTED';
}

function orgTime(d) {
  return fmtTime(d, ORG_TZ);
}

export const presenceService = new PresenceService();