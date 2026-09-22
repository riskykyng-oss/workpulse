const ORG_TZ = 'Africa/Harare';

export function fmtTime(iso, tz = ORG_TZ) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
  } catch {
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
}

export function fmtDate(iso, tz = ORG_TZ) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(d);
  } catch {
    return d.toLocaleDateString('en-GB');
  }
}

export function fmtMin(min) {
  if (min === null || min === undefined || Number.isNaN(min)) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

export function nowOrgHourMin() {
  const now = new Date();
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: ORG_TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(now);
}

export function fmtClock(min) {
  if (min === null || min === undefined || Number.isNaN(min)) return '—';
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export const STATUS_META = {
  PRESENT: { label: 'Present', cls: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  LATE: { label: 'Late', cls: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  ABSENT: { label: 'Absent', cls: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
  ON_LEAVE: { label: 'On leave', cls: 'bg-sky-100 text-sky-700', dot: 'bg-sky-500' },
  NOT_EXPECTED: { label: 'Not expected', cls: 'bg-slate-100 text-slate-500', dot: 'bg-slate-400' },
  NEEDS_REVIEW: { label: 'Needs review', cls: 'bg-purple-100 text-purple-700', dot: 'bg-purple-500' },
  MANUALLY_SET: { label: 'Manually set', cls: 'bg-indigo-100 text-indigo-700', dot: 'bg-indigo-500' },
};

export function StatusBadge({ status }) {
  const meta = STATUS_META[status] || { label: status, cls: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400' };
  return (
    <span className={`badge ${meta.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}