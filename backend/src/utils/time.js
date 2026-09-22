/**
 * Org-timezone calendar helpers. All "days" are calendar days in the
 * organisation timezone (default Africa/Harare). Times are stored as UTC
 * instants (timestamptz) in PostgreSQL; we convert only where a wall-clock
 * reading in the org timezone is required.
 */

const ORG_TZ = 'Africa/Harare';

const dtfCache = new Map();

function formatter(tz, options) {
  const key = `${tz}|${JSON.stringify(options)}`;
  if (!dtfCache.has(key)) {
    dtfCache.set(key, new Intl.DateTimeFormat('en-CA', { timeZone: tz, ...options }));
  }
  return dtfCache.get(key);
}

/** Offset (minutes ahead of UTC) of an instant in the given timezone. */
export function tzOffsetMinutes(instant, tz = ORG_TZ) {
  const t = typeof instant === 'number' ? new Date(instant) : instant;
  const dtf = formatter(tz, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const map = {};
  for (const part of dtf.formatToParts(t)) map[part.type] = part.value;
  const asUTC = Date.UTC(
    Number(map.year), Number(map.month) - 1, Number(map.day),
    Number(map.hour), Number(map.minute), Number(map.second),
  );
  return Math.round((asUTC - t.getTime()) / 60000);
}

/** Org-local wall clock reading for an instant, as { y, m, d, h, min } numbers. */
export function orgParts(instant, tz = ORG_TZ) {
  const t = typeof instant === 'number' ? new Date(instant) : instant;
  const dtf = formatter(tz, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const map = {};
  for (const part of dtf.formatToParts(t)) map[part.type] = part.value;
  const normalizeHour = (h) => (h === '24' ? '00' : h);
  return {
    y: Number(map.year),
    m: Number(map.month),
    d: Number(map.day),
    h: Number(normalizeHour(map.hour)),
    min: Number(map.minute),
    s: Number(map.second),
    weekday: t.getUTCDay(), // not used directly; see orgWeekday
  };
}

/** ISO weekday (1=Mon..7=Sun) of the org-local calendar day containing `instant`. */
export function orgWeekday(instant, tz = ORG_TZ) {
  const localMidnight = orgDayStart(orgYmd(instant, tz), tz);
  return localMidnight.getUTCDay() === 0 ? 7 : localMidnight.getUTCDay();
}

/** 'YYYY-MM-DD' of the org-local calendar day containing `instant`. */
export function orgYmd(instant, tz = ORG_TZ) {
  const { y, m, d } = orgParts(instant, tz);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Instant representing 00:00 of the org-local calendar day `ymd` ('YYYY-MM-DD').
 */
export function orgDayStart(ymd, tz = ORG_TZ) {
  const [y, m, d] = ymd.split('-').map(Number);
  const nearNoon = Date.UTC(y, m - 1, d, 12, 0, 0);
  const offset = tzOffsetMinutes(nearNoon, tz);
  return new Date(Date.UTC(y, m - 1, d) - offset * 60000);
}

/** Minutes after midnight in the org timezone at the given instant. */
export function minuteOfDay(instant, tz = ORG_TZ) {
  const { h, min } = orgParts(instant, tz);
  return h * 60 + min;
}

/**
 * 'YYYY-MM-DD' of the day the organisation is currently "on". Defaults to the
 * real org-local wall clock day, but can be pinned with DEMO_TODAY_YMD so the
 * canonical demo day stays "today" regardless of when the app is run.
 */
export function demoTodayYmd() {
  return process.env.DEMO_TODAY_YMD || orgYmd(new Date());
}

/** 'YYYY-MM' anchored to the demo-anchored org day the app is "on". */
export function demoMonthYmd() {
  return demoTodayYmd().slice(0, 7);
}

/** Day-start Date of the org day the app is currently "on". */
export function orgToday(tz = ORG_TZ) {
  return orgDayStart(demoTodayYmd(), tz);
}

/** 'YYYY-MM' for the org-local month of an instant. */
export function orgMonth(instant, tz = ORG_TZ) {
  const { y, m } = orgParts(instant, tz);
  return `${y}-${String(m).padStart(2, '0')}`;
}

/** First instant of org-local month `m` ('YYYY-MM'). */
export function monthStartUTC(m, tz = ORG_TZ) {
  const [y, mm] = m.split('-').map(Number);
  return orgDayStart(`${y}-${String(mm).padStart(2, '0')}-01`, tz);
}

/** First instant AFTER the org-local month `m`. */
export function nextMonthStartUTC(m, tz = ORG_TZ) {
  const [y, mm] = m.split('-').map(Number);
  const nextY = mm === 12 ? y + 1 : y;
  const nextM = mm === 12 ? 1 : mm + 1;
  return orgDayStart(`${nextY}-${String(nextM).padStart(2, '0')}-01`, tz);
}

/** Number of calendar days in org-local month `m`. */
export function daysInMonth(m) {
  const [y, mm] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mm, 0)).getUTCDate();
}

/** All org-local day starts in month `m`, oldest first. */
export function monthDayStarts(m, tz = ORG_TZ) {
  const out = [];
  const start = monthStartUTC(m, tz);
  for (let i = 0; i < daysInMonth(m); i++) {
    out.push(new Date(start.getTime() + i * 86400000));
  }
  return out;
}

/** True when the org-local calendar day `dayStart` falls on a working weekday (rules.workWeek). */
export function isWorkingDay(dayStart, workWeek = '1,2,3,4,5') {
  const allowed = workWeek.split(',').map((x) => Number(x));
  const w = dayStart.getUTCDay() === 0 ? 7 : dayStart.getUTCDay();
  return allowed.includes(w);
}

/** Working days in org-local month `m` following `workWeek`. */
export function workingDaysInMonth(m, workWeek = '1,2,3,4,5', tz = ORG_TZ) {
  return monthDayStarts(m, tz).filter((d) => isWorkingDay(d, workWeek));
}

/** Formatting helpers. */

export function fmtTime(instant, tz = ORG_TZ) {
  if (!instant) return 'â€”';
  const { h, min } = orgParts(instant, tz);
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export function fmtDate(instant, tz = ORG_TZ) {
  if (!instant) return 'â€”';
  return orgYmd(instant, tz);
}

/** "4h 32m" */
export function fmtDuration(minutes) {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h === 0) return `${mm}m`;
  return `${h}h ${String(mm).padStart(2, '0')}m`;
}
