import bcrypt from 'bcryptjs';
import { orgDayStart, monthStartUTC, workingDaysInMonth } from '../src/utils/time.js';
import { normalizeRules, evaluateDay, decideStatus } from '../src/services/presenceEngine.js';

const ORG_TZ = 'Africa/Harare';
const TODAY_YMD = '2026-09-21';
const DEMO_PASSWORD = 'workpulse';

// ---------------------------------------------------------------------------
// Deterministic randomness (every run reproduces the same company).
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(r, arr) {
  return arr[Math.floor(r() * arr.length)];
}

/** Weighted index pick for "who tends to be absent/late" realism. */
function weightedIndex(weights, r) {
  const sum = weights.reduce((a, b) => a + b, 0);
  let x = r() * sum;
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i];
    if (x <= 0) return i;
  }
  return weights.length - 1;
}

function randId(r) {
  const hex = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 12; i++) s += hex[Math.floor(r() * 16)];
  return s;
}

function dayFor(ymd) {
  return orgDayStart(ymd, ORG_TZ);
}

function monthDays(month) {
  return workingDaysInMonth(month, '1,2,3,4,5', ORG_TZ);
}

function isPartTimer(empNo) {
  return partTimerSchedule.has(empNo);
}

// ---------------------------------------------------------------------------
// Name pools (realistic Harare workforce).
// ---------------------------------------------------------------------------

const FIRST = [
  'Tendai', 'John', 'Sarah', 'Peter', 'Tafadzwa', 'Chipo', 'Kudzai', 'Memory', 'Blessing', 'Rumbidzai',
  'Tadiwa', 'Farai', 'Nyasha', 'Takudzwa', 'Rutendo', 'Simbarashe', 'Tatenda', 'Munyaradzi', 'Precious',
  'Tanaka', 'Anesu', 'Mutsa', 'Vimbai', 'Tinotenda', 'Kudakwashe', 'Tariro', 'Ropafadzo', 'Panashe',
  'Shamiso', 'Nokutenda', 'Tafara', 'Gamuchirai', 'Rufaro', 'Kundai', 'Tinashe', 'Mufaro', 'Wadzanai',
  'Makanaka', 'Ngonidzashe', 'Takunda', 'Pardon', 'Lloyd', 'Michael', 'Brian', 'Batsirai', 'Tendekai',
  'Grace', 'Judith', 'Lawrence',
];
const LAST = [
  'Moyo', 'Ncube', 'Dube', 'Chikore', 'Sibanda', 'Tshuma', 'Mpofu', 'Banda', 'Mhlanga', 'Ndlovu',
  'Sithole', 'Nyoni', 'Hove', 'Mabika', 'Chirwa', 'Makoni', 'Mutasa', 'Gumbo', 'Zhou', 'Mukwena',
  'Chigumbu', 'Matongo', 'Hungwe', 'Soko', 'Mavhunga', 'Dzviti', 'Charumbira', 'Chimbetete', 'Pfupa',
  'Goredema',
];

const POSITIONS = {
  Operations: ['Operations Officer', 'Operations Lead', 'Warehouse Supervisor', 'Production Planner', 'Quality Controller', 'Operations Assistant'],
  Sales: ['Sales Executive', 'Account Manager', 'Key Account Manager', 'Sales Development Rep', 'Area Sales Lead'],
  'Customer Support': ['Support Specialist', 'Senior Support Analyst', 'Customer Success Manager', 'Support Team Lead'],
  IT: ['IT Support Engineer', 'Systems Administrator', 'Network Engineer', 'Security Analyst', 'DevOps Engineer'],
  Finance: ['Accountant', 'Financial Analyst', 'Payables Officer', 'Receivables Officer', 'Finance Manager'],
  Marketing: ['Marketing Specialist', 'Brand Lead', 'Digital Marketer', 'Content Creator', 'Events Coordinator'],
  Logistics: ['Logistics Coordinator', 'Dispatch Officer', 'Fleet Controller', 'Inventory Associate'],
  HR: ['HR Administrator', 'HR Generalist', 'People Operations Partner', 'Recruiter'],
};

// ---------------------------------------------------------------------------
// Canonical company shape (Section 3 — must reconcile exactly).
// ---------------------------------------------------------------------------

const DEPTS = [
  { name: 'Operations', total: 60, late: 5, leave: 1, absent: 4, notExpected: 1 },
  { name: 'Sales', total: 48, late: 4, leave: 3, absent: 3, notExpected: 2 },
  { name: 'Customer Support', total: 34, late: 1, leave: 1, absent: 2, notExpected: 0 },
  { name: 'IT', total: 32, late: 2, leave: 1, absent: 1, notExpected: 1 },
  { name: 'Finance', total: 24, late: 1, leave: 1, absent: 1, notExpected: 1 },
  { name: 'Marketing', total: 22, late: 1, leave: 1, absent: 1, notExpected: 1 },
  { name: 'Logistics', total: 16, late: 0, leave: 0, absent: 2, notExpected: 0 },
  { name: 'HR', total: 12, late: 0, leave: 0, absent: 1, notExpected: 0 },
];

// Named employees that must appear in the UI exactly as described.
const NAMED = {
  'John Moyo': { dept: 'HR', position: 'HR Administrator', arrivalMin: 468 },       // 07:48
  'Sarah Ncube': { dept: 'Finance', position: 'Financial Analyst', arrivalMin: 471 }, // 07:51
  'Peter Dube': { dept: 'Sales', position: 'Sales Executive', arrivalMin: 494 },     // 08:14 → Late
  'Tendai Chikore': { dept: 'Operations', position: 'Operations Officer', arrivalMin: 468 }, // canonical 8h35m day
};
const NAMED_SET = new Set(Object.keys(NAMED));

// Part-time dept quotas used for the canonical snapshot (these people are not
// expected on Mondays = the 6 "Not expected" today).
const PART_TIME_QUOTA = { Operations: 1, Sales: 2, 'Customer Support': 0, IT: 1, Finance: 1, Marketing: 1, Logistics: 0, HR: 0 };

// August leave-days / absent-days per department. Along with the part-time
// off-days these reconcile the company to exactly 4,693 present-days (90.1%).
const AUG_LEAVE_DAYS = { Operations: 21, Sales: 18, 'Customer Support': 8, IT: 9, Finance: 5, Marketing: 6, Logistics: 3, HR: 2 };
const AUG_ABSENT_DAYS = { Operations: 88, Sales: 71, 'Customer Support': 50, IT: 47, Finance: 35, Marketing: 32, Logistics: 24, HR: 18 };

// ---------------------------------------------------------------------------
// Part-time schedules (keyed by real employeeNo, populated in main()).
// ---------------------------------------------------------------------------

const partTimerSchedule = new Map(); // employeeNo → [weekday numbers worked]

let DEPT_BY_ID = new Map(); // department name → id (populated by main)

/** Every (employee, working-day) the person is NOT expected (off their tour). */
function partTimerOffKeys(employees, days) {
  const keys = new Set();
  for (const e of employees) {
    const sched = partTimerSchedule.get(e.employeeNo);
    if (!sched) continue;
    for (const day of days) {
      const wd = day.getUTCDay() === 0 ? 7 : day.getUTCDay();
      if (!sched.includes(wd)) keys.add(`${e.dbid}:${day.getTime()}`);
    }
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Month/day status builders (deterministic, exact-count).
// ---------------------------------------------------------------------------

function buildLeaveGrid(strata, employees, days, deptById, rng, avoid) {
  const set = new Set();
  for (const [dept, want] of Object.entries(strata)) {
    if (!want) continue;
    const pool = employees.filter((e) => e.departmentId === deptById.get(dept) && !NAMED_SET.has(e.name) && !isPartTimer(e.employeeNo));
    if (!pool.length) continue;
    let added = 0;
    let guard = 0;
    while (added < want && guard++ < want * 400) {
      const e = pool[Math.floor(rng() * pool.length)];
      const day = days[Math.floor(rng() * days.length)];
      const key = `${e.dbid}:${day.getTime()}`;
      if (set.has(key) || (avoid && avoid.has(key))) continue;
      set.add(key);
      added++;
    }
  }
  return set;
}

function buildDefaultLeave(employees, days, rng, avoid) {
  const pool = employees.filter((e) => !NAMED_SET.has(e.name));
  const set = new Set();
  const want = 10;
  let guard = 0;
  while (set.size < want && guard++ < want * 400) {
    const e = pool[Math.floor(rng() * pool.length)];
    const day = days[Math.floor(rng() * days.length)];
    const key = `${e.dbid}:${day.getTime()}`;
    if (set.has(key) || avoid.has(key)) continue;
    set.add(key);
  }
  return set;
}

function buildAbsentGrid(strata, employees, days, deptById, rng, avoid) {
  const set = new Set();
  for (const [dept, want] of Object.entries(strata)) {
    if (!want) continue;
    const pool = employees.filter(
      (e) => e.departmentId === deptById.get(dept) && !NAMED_SET.has(e.name) && !isPartTimer(e.employeeNo),
    );
    if (!pool.length) continue;
    let added = 0;
    let guard = 0;
    while (added < want && guard++ < want * 400) {
      const e = pool[Math.floor(rng() * pool.length)];
      const day = days[Math.floor(rng() * days.length)];
      const key = `${e.dbid}:${day.getTime()}`;
      if (set.has(key) || (avoid && avoid.has(key))) continue;
      set.add(key);
      added++;
    }
  }
  return set;
}

function buildAbsentFill(budget, employees, days, rng, avoid) {
  const pool = employees.filter((e) => !NAMED_SET.has(e.name) && !isPartTimer(e.employeeNo));
  const propensities = pool.map(() => (rng() < 0.12 ? 0.35 : 0.04));
  const set = new Set();
  let guard = 0;
  while (set.size < budget && guard++ < Math.max(budget * 30, 10000)) {
    const e = pool[weightedIndex(propensities, rng)];
    const day = days[Math.floor(rng() * days.length)];
    const key = `${e.dbid}:${day.getTime()}`;
    if (set.has(key) || (avoid && avoid.has(key))) continue;
    set.add(key);
  }
  return set;
}

function buildLateExact(target, employees, days, rng, avoid) {
  const pool = employees.filter((e) => !NAMED_SET.has(e.name));
  const propensities = pool.map(() => (rng() < 0.2 ? 0.5 : 0.03));
  const set = new Set();
  let guard = 0;
  while (set.size < target && guard++ < target * 200) {
    const e = pool[weightedIndex(propensities, rng)];
    const day = days[Math.floor(rng() * days.length)];
    const key = `${e.dbid}:${day.getTime()}`;
    if (set.has(key) || (avoid && avoid.has(key))) continue;
    set.add(key);
  }
  return set;
}

// ---------------------------------------------------------------------------
// Today partition (the canonical 219/14/8/15/6 snapshot).
// ---------------------------------------------------------------------------

function buildTodayRoles(employees) {
  const modes = new Map();

  // Part-timers whose tour excludes Monday → not expected today.
  const todayWeekday = 1; // Monday
  for (const e of employees) {
    const sched = partTimerSchedule.get(e.employeeNo);
    if (sched && !sched.includes(todayWeekday)) modes.set(e.id, 'notExpected');
  }

  const nonNamed = (e) => !NAMED_SET.has(e.name);
  const lateOf = { Operations: 5, Sales: 4, 'Customer Support': 1, IT: 2, Finance: 1, Marketing: 1, Logistics: 0, HR: 0 };

  for (const d of DEPTS) {
    let pool = employees.filter((e) => e.departmentId === DEPT_BY_ID.get(d.name) && nonNamed(e) && !modes.has(e.id));
    const g = DEPTS.find((x) => x.name === d.name);
    if (g.leave) {
      for (const e of pool.slice(0, g.leave)) modes.set(e.id, 'leave');
      pool = pool.filter((e) => !modes.has(e.id));
    }
    if (g.absent) {
      for (const e of pool.slice(0, g.absent)) modes.set(e.id, 'absent');
      pool = pool.filter((e) => !modes.has(e.id));
    }
    const lc = lateOf[d.name];
    if (lc) {
      const picked = [];
      if (d.name === 'Sales') {
        const peter = employees.find((e) => e.name === 'Peter Dube');
        if (peter && !modes.has(peter.id)) picked.push(peter);
      }
      for (const e of pool) {
        if (picked.length >= lc) break;
        if (picked.includes(e)) continue;
        picked.push(e);
      }
      for (const e of picked) modes.set(e.id, 'late');
      pool = pool.filter((e) => !modes.has(e.id));
    }
  }

  for (const e of employees) {
    if (!modes.has(e.id)) modes.set(e.id, 'present');
  }
  return modes;
}

// ---------------------------------------------------------------------------
// Arrival / departure / lunch samplers.
// ---------------------------------------------------------------------------

/** Fixed minute layouts for the named employees (used every working day). */
const FIXED_DAY = {
  'John Moyo': [468, 1023, 0, 0],
  'Sarah Ncube': [471, 1021, 0, 0],
  'Peter Dube': [494, 1025, 0, 0],
  'Tendai Chikore': [468, 1025, 42, 785],
};

function arrivalDepartureLunch(e, hint, rng) {
  const fx = FIXED_DAY[e.name];
  if (fx) {
    const [arrival, departure, lunch, lunchStart] = fx;
    return { arrival, departure, lunch, lunchStart, lunchEnd: lunchStart + lunch };
  }
  const arrival = hint === 'LATE'
    ? 491 + Math.floor(rng() * 23)                  // 08:11 – 08:33
    : 458 + Math.floor(rng() * 27);                 // 07:38 – 08:04
  const departure = 982 + Math.floor(rng() * 34);   // 16:22 – 16:56
  const lunch = rng() < 0.3 ? 30 + Math.floor(rng() * 31) : 0;
  const lunchStart = lunch ? 779 + Math.floor(rng() * 20) : 0;
  return { arrival, departure, lunch, lunchStart, lunchEnd: lunch ? lunchStart + lunch : 0 };
}

// ---------------------------------------------------------------------------
// Month generator — writes records + events + sessions, reconciled exactly.
// ---------------------------------------------------------------------------

async function generateMonth({
  prisma, employees, days, rr, periodId, rngSeed, network, primaryByEmp,
  leaveGrid, absentGrid, lateTarget, targetPresent, onSiteIds,
}) {
  const rng = mulberry32(rngSeed);
  const emps = employees[0]?.dbid ? employees : employees.map((e) => ({ ...e, dbid: e.id }));
  const expSlots = emps.length * days.length;
  const partOff = partTimerOffKeys(emps, days);

  const leaveSet = leaveGrid
    ? buildLeaveGrid(leaveGrid, emps, days, DEPT_BY_ID, mulberry32(rngSeed + 1), partOff)
    : buildDefaultLeave(emps, days, mulberry32(rngSeed + 1), partOff);

  const absentBudget = targetPresent != null
    ? Math.max(0, expSlots - targetPresent - leaveSet.size - partOff.size)
    : Math.round(expSlots * 0.06314);
  const lateAvoid = new Set([...leaveSet, ...partOff]);

  const absentSet = absentGrid
    ? buildAbsentGrid(absentGrid, emps, days, DEPT_BY_ID, mulberry32(rngSeed + 2), lateAvoid)
    : buildAbsentFill(absentBudget, emps, days, mulberry32(rngSeed + 2), lateAvoid);

  const lateAvoidAll = new Set([...lateAvoid, ...absentSet]);
  const lateSet = lateTarget != null
    ? buildLateExact(lateTarget, emps, days, mulberry32(rngSeed + 3), lateAvoidAll)
    : buildLateExact(Math.round(expSlots * 0.062), emps, days, mulberry32(rngSeed + 3), lateAvoidAll);

  const records = [];
  const events = [];
  const sessions = [];
  let presentDays = 0;
  let lateTotal = 0;
  let totalNet = 0;

  for (let di = 0; di < days.length; di++) {
    const day = days[di];
    for (const e of emps) {
      const key = `${e.dbid}:${day.getTime()}`;
      if (partOff.has(key)) {
        records.push(emptyRecord(e, day, periodId, 'NOT_EXPECTED'));
        continue;
      }
      if (leaveSet.has(key)) {
        records.push(emptyRecord(e, day, periodId, 'ON_LEAVE'));
        continue;
      }
      if (absentSet.has(key)) {
        records.push(emptyRecord(e, day, periodId, 'ABSENT'));
        continue;
      }

      const hint = lateSet.has(key) ? 'LATE' : 'PRESENT';
      const { arrival, departure, lunch, lunchStart, lunchEnd } = arrivalDepartureLunch(e, hint, rng);
      const rec = await buildRecord({
        employee: e, day, arrival, departure, lunch, lunchStart, lunchEnd, rr, periodId,
      });
      records.push(rec.record);
      events.push(...rec.events);

      const dev = primaryByEmp.get(e.dbid);
      for (const ev of rec.events) {
        ev.employeeId = e.dbid;
        ev.networkId = network.id;
        ev.networkName = 'Head Office';
        ev.rawDeviceId = dev ? dev.identifier : `nodereg-${e.employeeNo}`;
        if (dev) ev.deviceId = dev.id;
      }

      const isLive = onSiteIds && onSiteIds.has(e.dbid);
      sessions.push(makeSession(rec.record, rec.evaluated, e, day, dev, 'Head Office', isLive));

      if (rec.record.status === 'PRESENT' || rec.record.status === 'LATE') {
        presentDays++;
        totalNet += rec.record.netMinutes;
        if (rec.record.status === 'LATE') lateTotal++;
      }
    }
  }

  await chunkCreate(prisma, 'attendanceRecord', records);
  await chunkCreate(prisma, 'networkEvent', events);
  await chunkCreate(prisma, 'presenceSession', sessions);

  return {
    presentDays,
    lateTotal,
    totalNetMinutes: totalNet,
    expectedSlots: expSlots,
    leaves: leaveSet.size,
    absents: absentSet.size,
    notExpected: partOff.size,
  };
}

function emptyRecord(employee, day, periodId, status) {
  return {
    employeeId: employee.dbid,
    date: day,
    status,
    arrivalAt: null,
    departureAt: null,
    grossMinutes: 0,
    lunchDeduction: 0,
    netMinutes: 0,
    lateMinutes: 0,
    needsReview: false,
    exceptionReason: null,
    monthlyPeriodId: periodId,
    source: 'auto',
  };
}

async function buildRecord({ employee, day, arrival, departure, lunch, lunchStart, lunchEnd, rr, periodId }) {
  const events = [];
  const evAt = (min) => new Date(day.getTime() + min * 60000);
  events.push({ eventType: 'CONNECT', timestamp: evAt(arrival), networkName: 'Head Office' });
  if (lunch && lunchStart) {
    events.push({ eventType: 'DISCONNECT', timestamp: evAt(lunchStart) });
    events.push({ eventType: 'CONNECT', timestamp: evAt(lunchEnd) });
  }
  // ~1 in 10 employees gets a bridged phone-sleep blip (6 min, merged silently).
  if (employee.employeeNo.slice(-1) === '6') {
    events.push({ eventType: 'DISCONNECT', timestamp: evAt(601) });
    events.push({ eventType: 'CONNECT', timestamp: evAt(607) });
  }
  events.push({ eventType: 'DISCONNECT', timestamp: evAt(departure) });
  events.sort((a, b) => a.timestamp - b.timestamp);

  const evaluated = evaluateDay({ events, rules: rr, now: evAt(departure + 1), timeZone: ORG_TZ });
  const decision = decideStatus({ evaluated, rules: rr, now: evAt(650), timeZone: ORG_TZ });

  const record = {
    employeeId: employee.dbid,
    date: day,
    status: decision.status,
    arrivalAt: evaluated.arrival,
    departureAt: evaluated.departure,
    grossMinutes: evaluated.grossMinutes,
    lunchDeduction: evaluated.lunchDeduction,
    netMinutes: evaluated.netMinutes,
    lateMinutes: evaluated.lateMinutes,
    needsReview: false,
    exceptionReason: null,
    monthlyPeriodId: periodId,
    source: 'auto',
  };
  return { record, events, evaluated };
}

function makeSession(record, evaluated, employee, day, dev, networkName, isLive) {
  return {
    employeeId: employee.dbid ?? employee.id,
    date: day,
    arrivalAt: evaluated.arrival,
    confirmedAt: evaluated.arrivalConfirmed ? evaluated.arrival : null,
    departureAt: evaluated.departure,
    lastSeenAt: isLive ? new Date() : evaluated.departure,
    grossMinutes: evaluated.grossMinutes,
    lunchDeduction: evaluated.lunchDeduction,
    lunchDetected: evaluated.lunchDetected,
    netMinutes: evaluated.netMinutes,
    state: record.status,
    evidence: {
      device: dev ? { name: dev.name, os: dev.os, type: dev.type, identityStrategy: dev.identityStrategy } : null,
      network: networkName,
      firstSeen: evaluated.arrival,
      confirmedAt: evaluated.arrivalConfirmed ? evaluated.arrival : null,
      segments: evaluated.segments,
      gaps: evaluated.gaps,
      lunchDetected: evaluated.lunchDetected,
    },
  };
}

// ---------------------------------------------------------------------------
// Today generator — the canonical snapshot, built exactly as specified.
// ---------------------------------------------------------------------------

async function generateToday({ prisma, employees, today, rr, network, primaryByEmp, roles, periodId }) {
  const records = [];
  const events = [];
  const sessions = [];
  const onSiteIds = new Set();

  const presentIds = employees.filter((e) => (roles.get(e.id) === 'present' || roles.get(e.id) === 'late')).map((e) => e.id);
  for (const i of [0, 7, 13, 19, 25]) {
    if (presentIds[i]) onSiteIds.add(presentIds[i]);
  }

  for (const e of employees) {
    const role = roles.get(e.id) || 'present';
    if (['leave', 'notExpected', 'absent'].includes(role)) {
      const status = role === 'leave' ? 'ON_LEAVE' : role === 'notExpected' ? 'NOT_EXPECTED' : 'ABSENT';
      records.push({
        employeeId: e.id,
        date: today,
        status,
        arrivalAt: null,
        departureAt: null,
        grossMinutes: 0,
        lunchDeduction: 0,
        netMinutes: 0,
        lateMinutes: 0,
        needsReview: false,
        exceptionReason: null,
        monthlyPeriodId: periodId,
        source: 'auto',
      });
      continue;
    }

    const status = role === 'late' ? 'LATE' : 'PRESENT';
    const r = mulberry32((e.employeeNo.length * 997 + (e.employeeNo.charCodeAt(0) || 0)) >>> 0);
    const { arrival, departure, lunch, lunchStart, lunchEnd } = arrivalDepartureLunch(e, status, r);

    const live = onSiteIds.has(e.id);
    const departureMin = live ? null : departure;
    const evAt = (min) => new Date(today.getTime() + min * 60000);
    const evs = [];
    evs.push({ eventType: 'CONNECT', timestamp: evAt(arrival), networkName: 'Head Office' });
    if (lunch && lunchStart) {
      evs.push({ eventType: 'DISCONNECT', timestamp: evAt(lunchStart) });
      evs.push({ eventType: 'CONNECT', timestamp: evAt(lunchEnd) });
    }
    if (departureMin != null) evs.push({ eventType: 'DISCONNECT', timestamp: evAt(departureMin) });
    evs.sort((a, b) => a.timestamp - b.timestamp);

    const dev = primaryByEmp.get(e.id);
    for (const ev of evs) {
      ev.employeeId = e.id;
      ev.networkId = network.id;
      ev.networkName = 'Head Office';
      ev.rawDeviceId = dev ? dev.identifier : `nodereg-${e.employeeNo}`;
      if (dev) ev.deviceId = dev.id;
    }

    const evaluated = evaluateDay({ events: evs, rules: rr, now: departureMin != null ? evAt(departureMin + 1) : Date.now(), timeZone: ORG_TZ });
    const decision = decideStatus({ evaluated, rules: rr, now: Date.now(), timeZone: ORG_TZ });

    const record = {
      employeeId: e.id,
      date: today,
      status: decision.status,
      arrivalAt: evaluated.arrival,
      departureAt: evaluated.departure,
      grossMinutes: evaluated.grossMinutes,
      lunchDeduction: evaluated.lunchDeduction,
      netMinutes: evaluated.netMinutes,
      lateMinutes: evaluated.lateMinutes,
      needsReview: false,
      exceptionReason: null,
      monthlyPeriodId: periodId,
      source: 'auto',
    };
    records.push(record);
    events.push(...evs);
    sessions.push(makeSession(record, evaluated, e, today, dev, 'Head Office', live));
  }

  await chunkCreate(prisma, 'attendanceRecord', records);
  await chunkCreate(prisma, 'networkEvent', events);
  await chunkCreate(prisma, 'presenceSession', sessions);
}

// ---------------------------------------------------------------------------
// DB plumbing
// ---------------------------------------------------------------------------

async function chunkCreate(prisma, model, rows, size = 4000) {
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size).map((row) => {
      const { id, createdAt, eventRec, ...rest } = row;
      void id; void createdAt; void eventRec;
      return rest;
    });
    if (!chunk.length) continue;
    await prisma[model].createMany({ data: chunk, skipDuplicates: true });
  }
}

async function recordAudit(prisma, actor, action, targetType, targetId, reason, detail) {
  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      actorName: 'John Moyo',
      action,
      targetType,
      targetId,
      reason: reason || null,
      detail: detail ?? undefined,
    },
  });
}

// ---------------------------------------------------------------------------
// Main seed — canonical demo company (Harcourt Group, 248 employees).
// ---------------------------------------------------------------------------

export async function main({ prisma }) {
  const today = dayFor(TODAY_YMD);

  // --------------------------------------------------------------- Org & rules
  const org = await prisma.organization.create({
    data: { name: 'Harcourt Group', timezone: ORG_TZ, workWeek: '1,2,3,4,5', retentionDays: 365 },
  });
  const location = await prisma.location.create({ data: { name: 'Head Office', organizationId: org.id } });
  const network = await prisma.network.create({
    data: {
      locationId: location.id,
      name: 'Head Office',
      identifiers: '["situs-hq-5g","situs-hq-wifi"]',
      status: 'ONLINE',
    },
  });

  await prisma.attendanceRules.create({
    data: {
      organizationId: org.id,
      workStartMinutes: 480, workEndMinutes: 1020, lateThresholdMinutes: 490,
      confirmationWindowMinutes: 5, disconnectBridgeMinutes: 10, departureGraceMinutes: 15,
      absentCutoffMinutes: 600, lunchStartMinutes: 780, lunchEndMinutes: 840,
      lunchMode: 'HYBRID', lunchMinMinutes: 30, lunchMaxMinutes: 90, lunchFixedMinutes: 60,
      monthEndDayMode: 'LAST_DAY', monthEndTimeMinutes: 1439,
    },
  });
  const rules = await prisma.attendanceRules.findUnique({ where: { id: 1 } });
  const rr = normalizeRules(rules);

  // ------------------------------------------------------------- Departments
  const departments = [];
  for (const d of DEPTS) {
    const dept = await prisma.department.create({ data: { name: d.name, organizationId: org.id } });
    departments.push({ ...d, id: dept.id });
  }
  DEPT_BY_ID = new Map(departments.map((d) => [d.name, d.id]));

  // --------------------------------------------------------------- Employees
  const employees = [];
  const usedNames = new Set();
  let no = 0;
  for (const d of departments) {
    for (let i = 0; i < d.total; i++) {
      const r = mulberry32(777 + no * 13);
      let name;
      let position;
      const named = Object.entries(NAMED).find(([, v]) => v.dept === d.name) || null;
      if (i === 0 && named) {
        name = named[0];
        position = named[1].position;
      } else {
        for (let tries = 0; tries < 6; tries++) {
          const candidate = `${pick(r, FIRST)} ${pick(r, LAST)}`;
          if (!usedNames.has(candidate) && !NAMED_SET.has(candidate)) {
            name = candidate;
            break;
          }
        }
        if (!name) name = `${pick(r, FIRST)} ${pick(r, LAST)}`;
        position = pick(r, POSITIONS[d.name]);
      }
      usedNames.add(name);

      const first = name.split(' ')[0];
      const last = name.split(' ').slice(1).join(' ');
      employees.push({
        employeeNo: `WP-${String(1000 + no).padStart(4, '0')}`,
        name,
        firstName: first,
        lastName: last,
        email: `${first.toLowerCase()}.${last.replace(/ /g, '').toLowerCase()}@harcourt.co.zw`,
        position,
        departmentId: DEPT_BY_ID.get(d.name),
        employmentType: 'FULL_TIME',
        active: true,
        startDate: new Date(Date.UTC(2021 + (no % 4), (no * 7) % 12, (no * 3) % 28 + 1)),
      });
      no++;
    }
  }
  if (no !== 248) {
    // Safety net — deterministic pool guarantee, never expected to trigger.
    throw new Error(`Employee generation drifted: expected 248, got ${no}`);
  }

  // Part-time roster (kept off the named/leave/absent pools, drives NOT_EXPECTED).
  for (const [dept, quota] of Object.entries(PART_TIME_QUOTA)) {
    let taken = 0;
    for (const e of employees) {
      if (taken >= quota) break;
      if (e.departmentId !== DEPT_BY_ID.get(dept) || NAMED_SET.has(e.name)) continue;
      e.employmentType = 'PART_TIME';
      partTimerSchedule.set(e.employeeNo, [2, 4]); // works Tue + Thu
      taken++;
    }
  }

  await prisma.employee.createMany({ data: employees });
  const created = await prisma.employee.findMany({ orderBy: { employeeNo: 'asc' } });
  employees.forEach((e, i) => { e.dbid = created[i].id; });

  // Department managers.
  await prisma.department.update({ where: { id: DEPT_BY_ID.get('Finance') }, data: { managerId: created.find((e) => e.name === 'Sarah Ncube').id } });
  await prisma.department.update({ where: { id: DEPT_BY_ID.get('Operations') }, data: { managerId: created.find((e) => e.name === 'Tendai Chikore').id } });
  for (const d of departments) {
    if (d.name === 'Finance' || d.name === 'Operations') continue;
    const someone = created.find((e) => e.departmentId === d.id && !NAMED_SET.has(e.name));
    if (someone) await prisma.department.update({ where: { id: d.id }, data: { managerId: someone.id } });
  }

  // ------------------------------------------------------------------ Users
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  await prisma.user.createMany({
    data: [
      { email: 'admin@harcourt.co.zw', passwordHash: hash, role: 'HR_ADMIN', employeeId: created.find((e) => e.name === 'John Moyo').id, organizationId: org.id },
      { email: 'root@harcourt.co.zw', passwordHash: hash, role: 'SUPER_ADMIN', organizationId: org.id },
      { email: 'sarah.ncube@harcourt.co.zw', passwordHash: hash, role: 'MANAGER', employeeId: created.find((e) => e.name === 'Sarah Ncube').id, organizationId: org.id },
      { email: 'tendai.chikore@harcourt.co.zw', passwordHash: hash, role: 'EMPLOYEE', employeeId: created.find((e) => e.name === 'Tendai Chikore').id, organizationId: org.id },
    ],
  });
  const adminUser = await prisma.user.findUnique({ where: { email: 'admin@harcourt.co.zw' } });
  const johnUser = adminUser;

  // ---------------------------------------------------------------- Devices
  const devices = [];
  for (let i = 0; i < created.length; i++) {
    const r = mulberry32(4242 + i * 17);
    if (i % 83 === 0) continue; // ~3 employees registered no device
    const hasLaptop = r() < 0.18;
    devices.push({
      employeeId: created[i].id,
      name: `${created[i].firstName}'s phone`,
      type: 'PHONE',
      os: r() < 0.6 ? 'Android' : 'iOS',
      identifier: `cmp-${randId(r)}`,
      identityStrategy: 'COMPANION_UUID',
      status: 'ACTIVE',
      isPrimary: true,
    });
    if (hasLaptop) {
      devices.push({
        employeeId: created[i].id,
        name: `${created[i].firstName}'s laptop`,
        type: 'LAPTOP',
        os: 'Windows',
        identifier: `cmp-${randId(r)}`,
        identityStrategy: 'COMPANION_UUID',
        status: r() < 0.2 ? 'FALLBACK' : 'ACTIVE',
        isPrimary: false,
      });
    }
  }
  await prisma.device.createMany({ data: devices });
  const deviceRows = await prisma.device.findMany({ orderBy: { name: 'asc' } });
  const primaryByEmp = new Map();
  for (const d of deviceRows) {
    if (d.isPrimary) primaryByEmp.set(d.employeeId, d);
  }

  // -------------------------------------------------------------- Today roles
  const todayRoles = buildTodayRoles(created);

  // ------------------------------------------------------------ Months
  const augPeriod = await prisma.monthlyPeriod.create({ data: { month: '2026-08' } });
  const sepPeriod = await prisma.monthlyPeriod.create({ data: { month: '2026-09' } });

  // ---- August (21 working days, present-days target 4,693 = 90.1%)
  const augDays = monthDays('2026-08');
  const aug = await generateMonth({
    prisma,
    employees: created,
    days: augDays,
    rr,
    periodId: augPeriod.id,
    rngSeed: 909,
    network,
    primaryByEmp,
    leaveGrid: AUG_LEAVE_DAYS,
    absentGrid: AUG_ABSENT_DAYS,
    lateTarget: 291, // Peter Dube's fixed 21 late arrivals are added by the engine itself
    targetPresent: 4693,
  });

  // 3 manual corrections in August (each audited, small net bump).
  const corrRecords = await prisma.attendanceRecord.findMany({
    where: { monthlyPeriodId: augPeriod.id, status: 'LATE' },
    orderBy: [{ date: 'asc' }, { employeeId: 'asc' }],
    take: 3,
  });
  for (const record of corrRecords) {
    const oldV = { netMinutes: record.netMinutes, lunchDeduction: record.lunchDeduction };
    const newV = { netMinutes: record.netMinutes + 10, lunchDeduction: record.lunchDeduction + 10 };
    await prisma.$transaction(async (tx) => {
      await tx.attendanceRecord.update({
        where: { id: record.id },
        data: { netMinutes: newV.netMinutes, lunchDeduction: newV.lunchDeduction, source: 'manual' },
      });
      await tx.attendanceCorrection.create({
        data: {
          attendanceRecordId: record.id,
          oldValue: oldV,
          newValue: newV,
          reason: 'Dedicated lunch taken as recorded by cafeteria',
          actorId: johnUser.id,
          actorName: 'John Moyo',
        },
      });
    });
    await recordAudit(prisma, johnUser, 'attendance.correct', 'attendance', record.id, 'Dedicated lunch taken as recorded by cafeteria', { oldValue: oldV, newValue: newV });
  }

  // Compile + close August through the real service (single source of truth).
  const { monthlyService } = await import('../src/services/monthlyService.js');
  await monthlyService.compile('2026-08', 'WorkPulse system');
  await monthlyService.close('2026-08', { id: johnUser.id, name: 'John Moyo' }, 'August register reviewed and closed.');
  await recordAudit(prisma, johnUser, 'monthly.close', 'monthly_period', augPeriod.id, 'August register reviewed and closed.', null);

  // ---- September (01–19 past working days, live)
  const sepDays = monthDays('2026-09');
  const pastSepDays = sepDays.filter((d) => d.getTime() < today.getTime());
  const sep = await generateMonth({
    prisma,
    employees: created,
    days: pastSepDays,
    rr,
    periodId: sepPeriod.id,
    rngSeed: 7300,
    network,
    primaryByEmp,
    leaveGrid: null,
    absentGrid: null,
    lateTarget: 116, // plus Peter's fixed arrivals ≈ 130 late arrivals for Sept
    targetPresent: null,
  });

  // ---- Today (canonical snapshot)
  await generateToday({
    prisma,
    employees: created,
    today,
    rr,
    network,
    primaryByEmp,
    roles: todayRoles,
    periodId: sepPeriod.id,
  });
  await prisma.attendanceRecord.updateMany({
    where: { date: { gte: monthStartUTC('2026-09', ORG_TZ) } },
    data: { monthlyPeriodId: sepPeriod.id },
  });

  // ------------------------------------------------------------- Audit trail
  await recordAudit(prisma, johnUser, 'rules.update', 'rules', '1', 'Set lunch policy to Hybrid (30–90 min)', null);
  await recordAudit(prisma, johnUser, 'device.register', 'device', deviceRows[0]?.id, 'Registered primary device', null);

  // ------------------------------------------------------------- Verification
  const byStatus = (role) => [...todayRoles.values()].filter((v) => v === role).length;
  const present = byStatus('present') + byStatus('late');
  const late = byStatus('late');
  const onLeave = byStatus('leave');
  const absent = byStatus('absent');
  const notExpected = byStatus('notExpected');

  const augRate = Math.round((aug.presentDays / aug.expectedSlots) * 1000) / 10;
  const avgNet = aug.presentDays ? Math.round(aug.totalNetMinutes / aug.presentDays) : 0;

  console.log('================================================================');
  console.log('WorkPulse seed — Harcourt Group (canonical demo data)');
  console.log('================================================================');
  console.log(`Employees          : ${created.length}`);
  console.log(`Today (2026-09-21) : ${present} present (${late} late) + ${onLeave} on leave + ${absent} absent + ${notExpected} not expected = ${present + onLeave + absent + notExpected}`);
  console.log(`  ideal            : 219 present (14 late) + 8 leave + 15 absent + 6 not expected = 248`);
  console.log(`August present-days: ${aug.presentDays} / ${aug.expectedSlots} = ${augRate}% (target 4693 → 90.1%)`);
  console.log(`August lates       : ${aug.lateTotal} (target 312) · leaves ${aug.leaves} · absents ${aug.absents} · notExpected ${aug.notExpected}`);
  console.log(`August avg net     : ${Math.floor(avgNet / 60)}h ${String(avgNet % 60).padStart(2, '0')}m (≈ 8h 12m)`);
  console.log('================================================================');

  return {
    headcount: created.length,
    present, late, onLeave, absent, notExpected,
    aug: { ...aug, rate: augRate, avgNet },
    sep,
  };
}

// ---------------------------------------------------------------------------
// Direct-run support (`node prisma/seed.js`)
// ---------------------------------------------------------------------------

const maybeDirect = (() => {
  try {
    if (!process.argv[1]) return false;
    const slash = process.argv[1].replace(/\\/g, '/');
    return slash.endsWith('prisma/seed.js');
  } catch {
    return false;
  }
})();

if (maybeDirect) {
  process.env.AUTO_SETUP = '0';
  const { PrismaClient } = await import('@prisma/client');
  const { ensureDatabase } = await import('../src/config/database.js');
  const url = await ensureDatabase();
  const p = new PrismaClient();
  await main({ prisma: p });
  await p.$disconnect();
  process.exit(0);
}