import { describe, it, expect } from 'vitest';
import { orgDayStart } from '../utils/time.js';
import {
  normalizeRules,
  buildSegments,
  lunchDeduction,
  evaluateDay,
  decideStatus,
  liveNetMinutes,
  canonicalWorkedExample,
} from './presenceEngine.js';

const DAY = '2026-09-21'; // Monday in Africa/Harare (UTC+2)

// org-local wall clock → UTC instant for the fixed demo day
const org = (hh, mm) => new Date(orgDayStart(DAY).getTime() + (hh * 60 + mm) * 60000);

const NOW = org(19, 30).getTime();

function day(rulesOverrides, events) {
  const rules = normalizeRules({ lunchMode: 'HYBRID', ...rulesOverrides });
  return evaluateDay({ events, rules, now: NOW, timeZone: 'Africa/Harare' });
}

describe('Tendai worked-hours example (acceptance)', () => {
  const { rules, events } = canonicalWorkedExample();

  it('hybrid lunch → exactly 8h35m net (gross 9h17m, lunch 42m)', () => {
    const ev = evaluateDay({ events, rules, now: NOW, timeZone: 'Africa/Harare' });
    expect(ev.grossMinutes).toBe(557); // 9h17m
    expect(ev.lunchDetected).toBe(42);
    expect(ev.lunchDeduction).toBe(42);
    expect(ev.netMinutes).toBe(515); // 8h35m
  });

  it('fixed 60-minute lunch → exactly 8h17m net', () => {
    const fixedRules = { ...rules, lunchMode: 'FIXED', lunchFixedMinutes: 60 };
    const ev = evaluateDay({ events, rules: fixedRules, now: NOW, timeZone: 'Africa/Harare' });
    expect(ev.grossMinutes).toBe(557);
    expect(ev.lunchDeduction).toBe(60);
    expect(ev.netMinutes).toBe(497); // 8h17m
  });

  it('detected mode uses raw 42 minutes', () => {
    const detRules = { ...rules, lunchMode: 'DETECTED' };
    const ev = evaluateDay({ events, rules: detRules, now: NOW, timeZone: 'Africa/Harare' });
    expect(ev.lunchDeduction).toBe(42);
    expect(ev.netMinutes).toBe(515);
  });
});

describe('late logic', () => {
  it('arrival 08:14 is late by 4 minutes (threshold 08:10)', () => {
    const ev = day({ lateThresholdMinutes: 490 }, [
      { eventType: 'CONNECT', timestamp: org(8, 14) },
      { eventType: 'DISCONNECT', timestamp: org(17, 0) },
    ]);
    expect(ev.isLate).toBe(true);
    expect(ev.lateMinutes).toBe(4);
    expect(decideStatus({ evaluated: ev, rules: normalizeRules({}), now: NOW, timeZone: 'Africa/Harare' }).status).toBe('LATE');
  });

  it('arrival 07:48 is on time', () => {
    const ev = day({ lateThresholdMinutes: 490 }, [
      { eventType: 'CONNECT', timestamp: org(7, 48) },
      { eventType: 'DISCONNECT', timestamp: org(17, 0) },
    ]);
    expect(ev.isLate).toBe(false);
    expect(decideStatus({ evaluated: ev, rules: normalizeRules({}), now: NOW, timeZone: 'Africa/Harare' }).status).toBe('PRESENT');
  });
});

describe('bridging short disconnects', () => {
  it('a 6-minute disconnect (under 10-min bridge) does not create a departure at 10:00', () => {
    const r = normalizeRules({ disconnectBridgeMinutes: 10, departureGraceMinutes: 15 });
    const events = [
      { eventType: 'CONNECT', timestamp: org(8, 0) },
      { eventType: 'DISCONNECT', timestamp: org(10, 0) },
      { eventType: 'CONNECT', timestamp: org(10, 6) },
      { eventType: 'DISCONNECT', timestamp: org(17, 0) },
    ];
    const { segments, gaps } = buildSegments(events, r);
    expect(segments).toHaveLength(1);
    // Only departure is the 17:00 exit — the 10:00 disconnect was bridged.
    expect(segments[0].end).toBe(org(17, 0).getTime());
    expect(gaps).toHaveLength(0);
  });

  it('a bridged gap is seamless for gross: 08:00 → 17:00 = 9h', () => {
    const r = normalizeRules({ lunchMode: 'DETECTED', disconnectBridgeMinutes: 10, departureGraceMinutes: 15 });
    const events = [
      { eventType: 'CONNECT', timestamp: org(8, 0) },
      { eventType: 'DISCONNECT', timestamp: org(10, 0) },
      { eventType: 'CONNECT', timestamp: org(10, 6) },
      { eventType: 'DISCONNECT', timestamp: org(17, 0) },
    ];
    const ev = evaluateDay({ events, rules: r, now: NOW, timeZone: 'Africa/Harare' });
    expect(ev.onSite).toBe(false);
    expect(ev.departure.getTime()).toBe(org(17, 0).getTime());
    expect(ev.grossMinutes).toBe(9 * 60);
    expect(ev.lunchDetected).toBe(0);
    expect(ev.netMinutes).toBe(9 * 60);
  });
});

describe('confirmation window', () => {
  it('a drive-by connection of 2 minutes is not a confirmed arrival', () => {
    const r = normalizeRules({ confirmationWindowMinutes: 5 });
    const events = [
      { eventType: 'CONNECT', timestamp: org(7, 30) },
      { eventType: 'DISCONNECT', timestamp: org(7, 32) },
    ];
    const ev = evaluateDay({ events, rules: r, now: NOW, timeZone: 'Africa/Harare' });
    expect(ev.arrivalConfirmed).toBe(false);
    expect(decideStatus({ evaluated: ev, rules: r, now: org(11, 0).getTime(), timeZone: 'Africa/Harare' }).status).toBe('ABSENT');
  });

  it('a connection held longer than the window confirms at first-connect time', () => {
    const r = normalizeRules({ confirmationWindowMinutes: 5 });
    const events = [
      { eventType: 'CONNECT', timestamp: org(8, 14) },
      { eventType: 'DISCONNECT', timestamp: org(13, 0) },
    ];
    const ev = evaluateDay({ events, rules: r, now: NOW, timeZone: 'Africa/Harare' });
    expect(ev.arrivalConfirmed).toBe(true);
    expect(ev.arrival.getHours()).toBe(8);
    expect(ev.arrival.getMinutes()).toBe(14);
  });
});

describe('lunch deduction modes', () => {
  it('hybrid clamps to minimum when detected is below minimum', () => {
    const r = normalizeRules({ lunchMode: 'HYBRID', lunchMinMinutes: 30, lunchMaxMinutes: 90 });
    expect(lunchDeduction(12, r).minutes).toBe(30);
  });

  it('hybrid clamps to maximum when detected exceeds maximum', () => {
    const r = normalizeRules({ lunchMode: 'HYBRID', lunchMinMinutes: 30, lunchMaxMinutes: 90 });
    expect(lunchDeduction(150, r).minutes).toBe(90);
  });

  it('fixed always returns the fixed amount', () => {
    const r = normalizeRules({ lunchMode: 'FIXED', lunchFixedMinutes: 60 });
    expect(lunchDeduction(0, r).minutes).toBe(60);
  });
});

describe('status decisions', () => {
  const rules = normalizeRules({});

  it('network feed gap → Needs review (Data gap), never Absent', () => {
    const ev = day({}, []);
    const st = decideStatus({ evaluated: ev, rules, now: NOW, timeZone: 'Africa/Harare', meta: { dataGap: true } });
    expect(st.status).toBe('NEEDS_REVIEW');
    expect(st.reason).toBe('DATA_GAP');
    expect(st.status).not.toBe('ABSENT');
  });

  it('on leave beats absence', () => {
    const ev = day({}, []);
    const st = decideStatus({ evaluated: ev, rules, now: NOW, meta: { onLeave: true } });
    expect(st.status).toBe('ON_LEAVE');
  });

  it('part-time / holiday gives Not expected', () => {
    const ev = day({}, []);
    const st = decideStatus({ evaluated: ev, rules, now: NOW, meta: { notExpected: true } });
    expect(st.status).toBe('NOT_EXPECTED');
  });

  it('no arrival after cutoff → Absent', () => {
    const ev = day({}, []);
    const st = decideStatus({ evaluated: ev, rules, now: NOW, timeZone: 'Africa/Harare' });
    expect(st.status).toBe('ABSENT');
  });
});

describe('live net counter', () => {
  const r = normalizeRules({ lunchMode: 'HYBRID', lunchStartMinutes: 780, lunchEndMinutes: 840, lunchMinMinutes: 30, lunchMaxMinutes: 90 });

  it('before lunch it counts only time on site (07:48 → 12:20 = 4h32m)', () => {
    const events = [
      { eventType: 'CONNECT', timestamp: org(7, 48) },
    ];
    const ev = evaluateDay({ events, rules: r, now: org(12, 20).getTime(), timeZone: 'Africa/Harare' });
    expect(ev.arrivalConfirmed).toBe(true);
    expect(liveNetMinutes(ev, r, org(12, 20).getTime(), 'Africa/Harare')).toBe(272); // 4h32m
  });

  it('net pauses during a detected lunch', () => {
    const events = [
      { eventType: 'CONNECT', timestamp: org(7, 48) },
      { eventType: 'DISCONNECT', timestamp: org(13, 5) },
      { eventType: 'CONNECT', timestamp: org(13, 47) },
    ];
    const r2 = { ...r, lunchMode: 'DETECTED' };
    const ev = evaluateDay({ events, rules: r2, now: org(15, 0).getTime(), timeZone: 'Africa/Harare' });
    expect(ev.lunchDetected).toBe(42);
    expect(liveNetMinutes(ev, r2, org(15, 0).getTime(), 'Africa/Harare')).toBe(390); // 432 − 42
  });
});