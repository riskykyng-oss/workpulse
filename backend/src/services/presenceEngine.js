/**
 * Presence engine — pure, unit-tested business logic for WorkPulse.
 *
 * This module is deliberately framework-free: it must not import Express,
 * Prisma or Socket.IO. Given raw network events plus attendance rules it
 * returns an employee's attendance state, exactly as the server would compute
 * it, so the browser can never tamper with the calculations.
 *
 * Clock work happens in absolute instants (imported timestamps) and minutes
 * after midnight in the organisation timezone (org calendar, handled by the
 * pure calendar helpers in utils/time.js).
 */

import { minuteOfDay, orgYmd, orgDayStart } from '../utils/time.js';

/** @typedef {{ eventType: 'CONNECT'|'DISCONNECT', timestamp: Date|number }[]} Events */

function toInt(v, fb) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

/**
 * Flatten persisted rule rows into the plain object the engine consumes.
 *
 * @param {object} r
 * @returns {object} normalized rules (all minute fields numeric, lunchMode string)
 */
export function normalizeRules(r) {
  return {
    workStartMinutes: toInt(r?.workStartMinutes, 480),
    workEndMinutes: toInt(r?.workEndMinutes, 1020),
    lateThresholdMinutes: toInt(r?.lateThresholdMinutes, 490),
    confirmationWindowMinutes: toInt(r?.confirmationWindowMinutes, 5),
    disconnectBridgeMinutes: toInt(r?.disconnectBridgeMinutes, 10),
    departureGraceMinutes: toInt(r?.departureGraceMinutes, 15),
    absentCutoffMinutes: toInt(r?.absentCutoffMinutes, 600),
    lunchStartMinutes: toInt(r?.lunchStartMinutes, 780),
    lunchEndMinutes: toInt(r?.lunchEndMinutes, 840),
    lunchMode: String(r?.lunchMode ?? 'HYBRID'),
    lunchMinMinutes: toInt(r?.lunchMinMinutes, 30),
    lunchMaxMinutes: toInt(r?.lunchMaxMinutes, 90),
    lunchFixedMinutes: toInt(r?.lunchFixedMinutes, 60),
  };
}

export function asMs(t) {
  if (t instanceof Date) return t.getTime();
  if (typeof t === 'number') return t;
  return new Date(t).getTime();
}

/**
 * Build connected segments from a sorted event list for one employee-day.
 *
 * - Gaps ≤ disconnectBridge are bridged (seamless presence).
 * - Gaps < departureGrace but > bridge are recorded as off-network windows and
 *   do NOT produce a departure (the person never "left").
 * - Gaps ≥ departureGrace close the segment at the disconnect instant
 *   (check-out time = last seen).
 *
 * Every real off-network window is collected in `gaps` — the engine keeps
 * enough raw truth to answer "what was deducted and why".
 *
 * @param {Events} events ascending, one employee
 * @param {object} rules normalized
 * @returns {{ segments: Array<{start:number,end:number|null}>, gaps: Array<{from:number,to:number,minutes:number}> }}
 */
export function buildSegments(events, rules) {
  const bridgeMin = rules.disconnectBridgeMinutes;
  const graceMin = rules.departureGraceMinutes;

  const pts = events
    .slice()
    .sort((a, b) => asMs(a.timestamp) - asMs(b.timestamp));

  const nextConnectTs = new Array(pts.length).fill(Infinity);
  let nc = Infinity;
  for (let i = pts.length - 1; i >= 0; i--) {
    if (pts[i].eventType === 'CONNECT') nc = asMs(pts[i].timestamp);
    nextConnectTs[i] = nc;
  }

  const segments = [];
  const gaps = [];
  let cur = null;

  for (let i = 0; i < pts.length; i++) {
    const e = pts[i];
    const t = asMs(e.timestamp);

    if (e.eventType === 'CONNECT') {
      if (!cur) cur = { start: t, end: null };
      continue;
    }

    // DISCONNECT
    if (!cur) continue;
    const resumeAt = nextConnectTs[i];
    const gapMin = resumeAt === Infinity ? Infinity : (resumeAt - t) / 60000;

    if (resumeAt !== Infinity && gapMin <= bridgeMin) {
      // Bridged — device is considered present throughout.
      continue;
    }
    if (resumeAt !== Infinity && gapMin < graceMin) {
      // Off the network but under the departure grace: still present,
      // the window is recorded for lunch/evidence use.
      gaps.push({ from: t, to: resumeAt, minutes: gapMin });
      continue;
    }
    // Real departure (or a live "device left, has not returned yet").
    if (resumeAt !== Infinity) {
      gaps.push({ from: t, to: resumeAt, minutes: gapMin });
    }
    cur.end = t;
    segments.push(cur);
    cur = null;
  }
  if (cur) segments.push(cur);
  return { segments, gaps };
}

/**
 * Off-network minutes inside the lunch window across the whole day, evaluated
 * up to `until` (an instant). Counts every real window (bridged or not).
 *
 * @param {Events} events
 * @param {object} rules normalized
 * @param {number} [until] evaluate up to this instant (live day)
 * @param {string} [tz]
 * @returns {number}
 */
export function detectedLunchMinutes(events, rules, until, tz = 'Africa/Harare') {
  const pts = events
    .slice()
    .sort((a, b) => asMs(a.timestamp) - asMs(b.timestamp));
  const cutoff = until ?? Infinity;

  const nextConnectTs = new Array(pts.length).fill(Infinity);
  let nc = Infinity;
  for (let i = pts.length - 1; i >= 0; i--) {
    if (pts[i].eventType === 'CONNECT') nc = asMs(pts[i].timestamp);
    nextConnectTs[i] = nc;
  }

  let detected = 0;
  for (let i = 0; i < pts.length; i++) {
    const e = pts[i];
    if (e.eventType !== 'DISCONNECT') continue;
    const resumeAt = Math.min(nextConnectTs[i], cutoff);
    if (resumeAt > asMs(e.timestamp)) {
      detected += overlapMinutes(asMs(e.timestamp), resumeAt, rules, tz);
    }
  }
  return Math.round(detected);
}

/** Overlap (minutes) between an absolute window and the org-day lunch window. */
function overlapMinutes(fromAbs, toAbs, rules, tz) {
  const day = orgDayStart(orgYmd(new Date(fromAbs), tz), tz);
  const winStart = day.getTime() + rules.lunchStartMinutes * 60000;
  const winEnd = day.getTime() + rules.lunchEndMinutes * 60000;
  const lo = Math.max(fromAbs, winStart);
  const hi = Math.min(toAbs, winEnd);
  return hi > lo ? (hi - lo) / 60000 : 0;
}

/**
 * Lunch deduction for a day given the detected off-network minutes in window.
 *
 * @param {number} detectedMinutes
 * @param {object} rules normalized
 * @returns {{ minutes:number, mode:string, detected:number }}
 */
export function lunchDeduction(detectedMinutes, rules) {
  let minutes;
  switch (rules.lunchMode) {
    case 'FIXED':
      minutes = rules.lunchFixedMinutes;
      break;
    case 'DETECTED':
      minutes = detectedMinutes;
      break;
    default: // HYBRID
      minutes = Math.min(Math.max(detectedMinutes, rules.lunchMinMinutes), rules.lunchMaxMinutes);
  }
  return { minutes: Math.max(0, Math.round(minutes)), mode: rules.lunchMode, detected: Math.round(detectedMinutes) };
}

/**
 * Full presence evaluation for one employee, one day.
 *
 * @param {object} args
 * @param {Events} args.events ascending network events for the employee-day
 * @param {object} args.rules normalized
 * @param {number} args.now current instant
 * @param {string} [args.timeZone]
 * @returns {object} complete state
 */
export function evaluateDay({ events, rules, now, timeZone = 'Africa/Harare' }) {
  const { segments, gaps } = buildSegments(events, rules);

  const first = segments[0] ?? null;
  const arrivalMs = first ? first.start : null;
  const arrivalConfirmed = (() => {
    if (!first) return false;
    if (first.end !== null) return first.end - first.start >= rules.confirmationWindowMinutes * 60000;
    return now - first.start >= rules.confirmationWindowMinutes * 60000;
  })();

  const arrival = arrivalMs ? new Date(arrivalMs) : null;
  const arrivalMinutes = arrival ? minuteOfDay(arrival, timeZone) : null;
  const lateMs = arrivalConfirmed && arrivalMinutes !== null
    ? Math.max(0, arrivalMinutes - rules.lateThresholdMinutes)
    : 0;
  const isLate = arrivalConfirmed && lateMs > 0;

  const last = segments[segments.length - 1] ?? first;
  const onSite = Boolean(last && last.end === null);
  const departureMs = onSite ? null : last ? last.end : null;

  // Gross time on site = last departure − arrival (span, not segmented sum).
  const grossMinutes = arrivalConfirmed && arrivalMs !== null
    ? Math.round(((departureMs ?? now) - arrivalMs) / 60000)
    : 0;

  const detected = detectedLunchMinutes(events, rules, onSite ? now : Infinity, timeZone);
  const lunch = lunchDeduction(detected, rules);
  const netMinutes = Math.max(0, grossMinutes - lunch.minutes);

  return {
    arrival,
    arrivalMinutes,
    arrivalConfirmed,
    isLate,
    lateMinutes: Math.round(lateMs),
    departure: departureMs ? new Date(departureMs) : null,
    onSite,
    grossMinutes,
    lunchDetected: detected,
    lunchDeduction: lunch.minutes,
    lunchMode: lunch.mode,
    netMinutes,
    segments: segments.map((s) => ({ start: new Date(s.start), end: s.end ? new Date(s.end) : null })),
    gaps: gaps.map((g) => ({ from: new Date(g.from), to: new Date(g.to), minutes: g.minutes })),
  };
}

/**
 * Decide the final status knowing the rules, the evaluated day and any
 * organisational metadata (leave, not-expected, network gap).
 *
 * @param {object} args
 * @param {object} args.evaluated result of evaluateDay
 * @param {object} args.rules normalized
 * @param {number} args.now
 * @param {string} [args.timeZone]
 * @param {object} [args.meta]
 * @param {boolean} [args.meta.onLeave]
 * @param {boolean} [args.meta.notExpected]
 * @param {boolean} [args.meta.dataGap]
 * @returns {{ status: string, reason?: string, needsReview: boolean }}
 */
export function decideStatus({ evaluated, rules, now, timeZone = 'Africa/Harare', meta = {} }) {
  if (meta.dataGap) {
    return { status: 'NEEDS_REVIEW', reason: 'DATA_GAP', needsReview: true };
  }
  if (meta.onLeave) {
    return { status: 'ON_LEAVE' };
  }
  if (meta.notExpected) {
    return { status: 'NOT_EXPECTED' };
  }

  if (!evaluated.arrivalConfirmed) {
    const nowMin = minuteOfDay(new Date(now), timeZone);
    if (nowMin >= rules.absentCutoffMinutes) {
      return { status: 'ABSENT' };
    }
    return { status: 'DETECTED' };
  }
  if (evaluated.isLate) {
    return { status: 'LATE' };
  }
  return { status: 'PRESENT' };
}

/**
 * Live running net-hours for an on-site employee (or the final value once
 * departed). Lunch deduction is applied progressively inside the lunch window
 * so the counter visibly pauses during a detected lunch.
 *
 * @param {object} evaluated result of evaluateDay
 * @param {object} rules normalized
 * @param {number} now
 * @param {string} [timeZone]
 * @returns {number}
 */
export function liveNetMinutes(evaluated, rules, now, timeZone = 'Africa/Harare') {
  const gross = evaluated.onSite && evaluated.arrival
    ? Math.round((now - asMs(evaluated.arrival)) / 60000)
    : evaluated.grossMinutes;

  if (!evaluated.arrival || !evaluated.arrivalConfirmed) return gross;

  const nowMin = minuteOfDay(new Date(now), timeZone);
  let deduction;
  if (rules.lunchMode === 'FIXED') {
    if (nowMin <= rules.lunchStartMinutes) deduction = 0;
    else if (nowMin >= rules.lunchEndMinutes) deduction = rules.lunchFixedMinutes;
    else {
      const span = rules.lunchEndMinutes - rules.lunchStartMinutes;
      const prog = (nowMin - rules.lunchStartMinutes) / span;
      deduction = Math.round(rules.lunchFixedMinutes * Math.min(1, Math.max(0, prog)));
    }
  } else if (nowMin <= rules.lunchStartMinutes) {
    // Nothing to deduct before the lunch window opens.
    deduction = 0;
  } else if (rules.lunchMode === 'DETECTED') {
    deduction = evaluated.lunchDetected;
  } else {
    deduction = Math.min(Math.max(evaluated.lunchDetected, rules.lunchMinMinutes), rules.lunchMaxMinutes);
  }
  return Math.max(0, gross - deduction);
}

/**
 * Canonical worked-hours example from the product brief (Tendai Chikore).
 * Arrival 07:48, departure 17:05, detected lunch 42 min → net 8h35m.
 * With a fixed 60-minute lunch the same day yields 8h17m.
 *
 * @returns {{ rules: object, events: Events }}
 */
export function canonicalWorkedExample() {
  const rules = normalizeRules({
    lateThresholdMinutes: 490,
    lunchMode: 'HYBRID',
    lunchStartMinutes: 780,
    lunchEndMinutes: 840,
    lunchMinMinutes: 30,
    lunchMaxMinutes: 90,
    lunchFixedMinutes: 60,
    disconnectBridgeMinutes: 10,
    departureGraceMinutes: 15,
  });
  const dayStart = orgDayStart('2026-09-21', 'Africa/Harare').getTime();
  const mk = (hh, mm) => new Date(dayStart + (hh * 60 + mm) * 60000);
  const events = [
    { eventType: 'CONNECT', timestamp: mk(7, 48) },
    { eventType: 'DISCONNECT', timestamp: mk(13, 5) },
    { eventType: 'CONNECT', timestamp: mk(13, 47) },
    { eventType: 'DISCONNECT', timestamp: mk(17, 5) },
  ];
  return { rules, events };
}