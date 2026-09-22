import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ShieldCheck, Clock } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Spinner } from '../components/ui';
import { StatusBadge, fmtTime, fmtMin } from '../lib/format';

export default function Me() {
  const { user } = useAuth();
  const empId = user?.employee?.id;
  const orgMonth = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(orgMonth);

  const { data: today, isLoading: tLoad } = useQuery({
    queryKey: ['me-today'],
    queryFn: () => api('/attendance/today'),
    refetchInterval: 15_000,
    enabled: !!empId,
  });

  const { data: monthData, isLoading: mLoad } = useQuery({
    queryKey: ['me-month', month],
    queryFn: () => api(`/attendance/employee/${empId}/month/${month}`),
    enabled: !!empId,
  });

  if (tLoad || (mLoad && monthData === undefined)) return <Spinner />;
  const record = today?.record;
  const days = (monthData?.days || []).filter((d) => d.date);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-xl font-bold">My day</h1>
        <p className="text-sm text-slate-500">
          {user?.employee?.name} · {user?.employee?.position} · {user?.employee?.department?.name}
        </p>
      </div>

      <div className="card p-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-lg font-bold text-brand-700">
            {(user?.employee?.name || 'U').split(' ').map((p) => p[0]).slice(0, 2).join('')}
          </div>
          <div className="flex-1">
            <p className="text-lg font-semibold">{user?.employee?.name}</p>
            <p className="text-sm text-slate-500">{user?.employee?.employeeNo} · {user?.employee?.employmentType}</p>
          </div>
          <div className="text-right">
            {record ? (
              <StatusBadge status={record.status} />
            ) : (
              <span className="badge bg-slate-100 text-slate-600">No record yet today</span>
            )}
          </div>
        </div>

        {record && (
          <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
            <Cell label="Arrival" value={record.arrivalAt ? fmtTime(record.arrivalAt) : '—'} />
            <Cell label="Departure" value={record.departureAt ? fmtTime(record.departureAt) : record.status === 'PRESENT' || record.status === 'LATE' ? 'on site' : '—'} />
            <Cell label="Net time" value={fmtMin(record.netMinutes ?? 0)} />
            <Cell label="Late" value={record.lateMinutes ? `${record.lateMinutes}m` : '0m'} />
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-4 border-t border-slate-100 pt-4 text-sm">
          <span className="flex items-center gap-1.5 text-emerald-600">
            <ShieldCheck className="h-4 w-4" /> Verified through {record?.verifiedThrough || 'Head Office network'}
          </span>
          <span className="flex items-center gap-1.5 text-slate-500">
            <Clock className="h-4 w-4" /> Work hours {today?.workHours?.start}–{today?.workHours?.end}
          </span>
          <span className="flex items-center gap-1.5 text-slate-500">
            <CheckCircle2 className="h-4 w-4" /> {month} {today?.record?.source === 'auto' ? 'auto-detected' : 'attendance by network feed'}
          </span>
        </div>
      </div>

      <div className="card p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">My month</h2>
          <select className="input w-auto" value={month} onChange={(e) => setMonth(e.target.value)}>
            {[orgMonth, prevM(orgMonth)].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        {days.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">No register entries for this month.</p>
        ) : (
          <div className="grid grid-cols-7 gap-2">
            {days.map((d) => (
              <div key={d.date} className="rounded-lg border border-slate-100 bg-slate-50 p-2 text-center">
                <p className="text-[11px] font-medium text-slate-400">{dayLabel(d.date)}</p>
                <p className="my-1 text-lg font-semibold">{dayNum(d.date)}</p>
                <StatusBadge status={d.status} />
                <p className="mt-1 text-[11px] tabular-nums text-slate-500">{d.netMinutes != null ? `${d.netMinutes}m` : '—'}</p>
                {d.arrival && <p className="text-[10px] tabular-nums text-slate-400">in {d.arrival}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Cell({ label, value }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-base font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function prevM(month) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function dayNum(iso) {
  return new Date(iso).getUTCDate();
}

function dayLabel(iso) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short' }).format(new Date(iso));
}