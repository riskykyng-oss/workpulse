import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Users,
  CheckCircle2,
  AlertTriangle,
  CalendarOff,
  Plane,
  EyeOff,
  UserX,
  Clock,
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { api } from '../api/client';
import { useRealtime } from '../socket';
import { StatCard, Spinner } from '../components/ui';
import { StatusBadge } from '../lib/format';
import { subDays, format } from 'date-fns';

export default function Dashboard() {
  const [feed, setFeed] = useState([]);
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    qc.invalidateQueries({ queryKey: ['live'] });
  };
  useRealtime({
    'attendance:updated': (p) => {
      setFeed((f) => [{ name: p?.employee || p?.name || 'Employee', kind: p?.kind || 'arrival', isLate: p?.isLate }, ...f].slice(0, 8));
      invalidate();
    },
    'attendance:totals': (p) => invalidate(),
    'attendance:exception': (p) => invalidate(),
  });

  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: () => api('/dashboard') });

  const { data: history } = useQuery({
    queryKey: ['history-30d'],
    queryFn: () => api('/attendance/history', { params: { from: subDays(new Date(), 29).toISOString(), to: new Date().toISOString() } }),
    staleTime: 60_000,
  });

  if (isLoading) return <Spinner />;

  const t = data?.totals;
  const depts = data?.departments || [];
  const exceptions = data?.exceptions || [];

  const byDay = {};
  for (const r of history?.records || []) {
    const d = format(new Date(r.date), 'yyyy-MM-dd');
    byDay[d] = byDay[d] || { date: d, present: 0, late: 0 };
    if (r.status === 'PRESENT') byDay[d].present += 1;
    if (r.status === 'LATE') byDay[d].late += 1;
  }
  const trend = Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date: format(new Date(date), 'dd MMM'), ...v }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Good day, Harcourt — live overview</h1>
        <p className="text-sm text-slate-500">Head office attendance for today, Africa/Harare.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-7">
        <StatCard icon={Activity} label="Attendance rate" value={`${t?.attendanceRate}%`} tone="violet" sub={`${t?.headcount} headcount`} />
        <StatCard icon={CheckCircle2} label="Present" value={t?.present} tone="emerald" sub="on site now" />
        <StatCard icon={Clock} label="Late arrivals" value={t?.late} tone="amber" />
        <StatCard icon={Plane} label="On leave" value={t?.onLeave} tone="sky" />
        <StatCard icon={UserX} label="Absent" value={t?.absent} tone="red" />
        <StatCard icon={EyeOff} label="Not expected" value={t?.notExpected} tone="slate" />
        <StatCard icon={CalendarOff} label="Needs review" value={t?.needsReview} tone="slate" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">Attendance by department (today)</h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="tbl">Department</th>
                  <th className="tbl text-right">Total</th>
                  <th className="tbl text-right">Present</th>
                  <th className="tbl text-right">Late</th>
                  <th className="tbl text-right">Leave</th>
                  <th className="tbl text-right">Absent</th>
                  <th className="tbl text-right">Rate</th>
                </tr>
              </thead>
              <tbody>
                {depts.map((d) => (
                  <tr key={d.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="td font-medium">{d.name}</td>
                    <td className="td text-right tabular-nums">{d.total}</td>
                    <td className="td text-right tabular-nums text-emerald-600">{d.present}</td>
                    <td className="td text-right tabular-nums text-amber-600">{d.late}</td>
                    <td className="td text-right tabular-nums text-sky-600">{d.onLeave}</td>
                    <td className="td text-right tabular-nums text-red-600">{d.absent}</td>
                    <td className="td text-right font-semibold tabular-nums">{d.attendanceRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <AlertTriangle className="h-4 w-4 text-amber-500" /> Needs attention
          </h2>
          <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {exceptions.length === 0 && <p className="text-sm text-slate-400">All clear.</p>}
            {exceptions.map((e) => (
              <div key={e.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium">{e.title}</p>
                  <span className="shrink-0 text-[10px] uppercase tracking-wider text-slate-400">{e.type}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">{e.note}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">Present vs late — last 30 days</h2>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={trend}>
              <defs>
                <linearGradient id="gPres" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gLate" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f7" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} width={30} tickLine={false} axisLine={false} />
              <Tooltip />
              <Area type="monotone" dataKey="present" name="Present" stroke="#10b981" fill="url(#gPres)" strokeWidth={2} />
              <Area type="monotone" dataKey="late" name="Late" stroke="#f59e0b" fill="url(#gLate)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Users className="h-4 w-4 text-brand-500" /> Live feed
          </h2>
          <div className="max-h-[220px] space-y-2 overflow-y-auto">
            {feed.length === 0 && <p className="text-sm text-slate-400">Realtime events will appear here as devices connect and disconnect.</p>}
            {feed.map((f, i) => (
              <div key={i} className="rounded-lg border border-slate-100 p-3 text-sm">
                <span className="font-medium">{f.name}</span>{' '}
                <span className="text-slate-500">
                  {f.kind === 'arrival' ? 'arrived' : 'left'} · <StatusBadge status={f.isLate ? 'LATE' : 'PRESENT'} />
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Who's on site now</h2>
        <div className="flex flex-wrap gap-2">
          {depts.map((d) => (
            <span key={d.id} className="badge bg-slate-100 text-slate-600">
              {d.name} · {d.present} on site
            </span>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Counts update live as device connections and disconnections are detected on the head office network.
        </p>
      </div>
    </div>
  );
}

void format;
void subDays;