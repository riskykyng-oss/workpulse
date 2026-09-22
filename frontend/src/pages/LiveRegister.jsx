import { useMemo, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
} from '@tanstack/react-table';
import { Search, Download, ArrowUpDown, Eye, RefreshCw, WifiOff, Wifi } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useRealtime } from '../socket';
import { Spinner, Modal, useToast, Empty } from '../components/ui';
import { StatusBadge, fmtTime, fmtMin } from '../lib/format';

export default function LiveRegister() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [dept, setDept] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [evidenceId, setEvidenceId] = useState(null);
  const [sort, setSort] = useState('ranking');
  const [outage, setOutage] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['live'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  useRealtime({
    'attendance:updated': () => invalidate(),
    'attendance:totals': () => invalidate(),
    'attendance:exception': () => invalidate(),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['live'],
    queryFn: () => api('/attendance/live'),
    refetchInterval: 5_000,
  });
  const records = useMemo(() => data?.records || [], [data]);

  const depts = useMemo(() => [...new Set(records.map((r) => r.employee.department.name))].sort(), [records]);

  const simulate = useMutation({
    mutationFn: ({ employeeId, kind, at }) =>
      api(`/simulate/${kind}`, { method: 'POST', body: { employeeId, at: at || undefined } }),
    onSuccess: (res) => {
      toast.success(res?.result?.status ? `Detection processed — status: ${res.result.status}` : 'Detection processed.');
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const toggleOutage = useMutation({
    mutationFn: (on) => api('/simulate/outage', { method: 'POST', body: { on } }),
    onMutate: (on) => setOutage(on),
  });

  const columns = useMemo(
    () => [
      {
        id: 'employee',
        header: 'Employee',
        accessorFn: (r) => `${r.employee.name} ${r.employee.employeeNo}`,
        cell: (info) => (
          <div>
            <p className="font-medium">{info.row.original.employee.name}</p>
            <p className="text-xs text-slate-400">
              {info.row.original.employee.employeeNo} · {info.row.original.employee.position}
            </p>
          </div>
        ),
      },
      { id: 'dept', header: 'Department', accessorFn: (r) => r.employee.department.name, cell: (info) => info.row.original.employee.department.name },
      {
        id: 'status',
        header: 'Status',
        accessorFn: (r) => r.status,
        cell: (info) => <StatusBadge status={info.row.original.status} />,
      },
      {
        id: 'arrival',
        header: 'Arrival',
        accessorFn: (r) => (r.arrivalAt ? fmtTime(r.arrivalAt) : ''),
        enableSorting: false,
      },
      {
        id: 'departure',
        header: 'Departure',
        accessorFn: (r) => (r.departureAt ? fmtTime(r.departureAt) : ''),
        enableSorting: false,
      },
      {
        id: 'net',
        header: 'Net time',
        accessorFn: (r) => r.netMinutes ?? -1,
        cell: (info) => <span className="tabular-nums">{fmtMin(info.row.original.netMinutes)}</span>,
      },
      {
        id: 'late',
        header: 'Late',
        accessorFn: (r) => r.lateMinutes ?? 0,
        cell: (info) => (
          <span className={clsx('tabular-nums', info.row.original.lateMinutes > 0 ? 'font-semibold text-amber-600' : 'text-slate-400')}>
            {info.row.original.lateMinutes ? `${info.row.original.lateMinutes}m` : '—'}
          </span>
        ),
      },
      {
        id: 'device',
        header: 'Device',
        accessorFn: (r) => r.employee.devices?.map((d) => d.name).join(', ') || '',
        enableSorting: false,
      },
    ],
    [],
  );

  const { getHeaderGroups, getRowModel } = useReactTable({
    data: records,
    columns,
    state: { sorting: sort === 'ranking' ? [{ id: 'status', desc: false }] : sort === 'net' ? [{ id: 'net', desc: true }] : [] },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: 'includesString',
  });

  const visible = getRowModel().rows
    .filter((row) => {
      const r = row.original;
      if (dept && r.employee.department.name !== dept) return false;
      if (status && r.status !== status) return false;
      if (q && !`${r.employee.name} ${r.employee.employeeNo} ${r.employee.department.name}`.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    })
    .map((row) => row.original);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Live register</h1>
          <p className="text-sm text-slate-500">Updated in real time as detections flow from the network.</p>
        </div>
        {['SUPER_ADMIN', 'HR_ADMIN'].includes(user.role) && (
          <button
            className={outage ? 'btn bg-slate-800 text-white hover:bg-slate-700' : 'btn-secondary'}
            onClick={() => toggleOutage.mutate(!outage)}
            disabled={toggleOutage.isPending}
          >
            {outage ? <WifiOff className="h-4 w-4" /> : <Wifi className="h-4 w-4" />}
            {outage ? 'Recover feed' : 'Simulate outage'}
          </button>
        )}
      </div>

      <div className="card flex flex-wrap items-center gap-3 p-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input className="input pl-9" placeholder="Search name or employee no…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input w-auto" value={dept} onChange={(e) => setDept(e.target.value)}>
          <option value="">All departments</option>
          {depts.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {['PRESENT', 'LATE', 'ABSENT', 'ON_LEAVE', 'NOT_EXPECTED', 'NEEDS_REVIEW', 'MANUALLY_SET'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select className="input w-auto" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="ranking">Sort: status</option>
          <option value="net">Sort: net time</option>
        </select>
        <span className="text-xs text-slate-400">
          {visible.length}/{records.length} rows
        </span>
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <Spinner />
        ) : visible.length === 0 ? (
          <Empty text="No rows match the current filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                {getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>
                    {hg.headers.map((h) => (
                      <th key={h.id} className="tbl" onClick={h.column.getToggleSortingHandler?.()}>
                        <span className="inline-flex cursor-pointer items-center gap-1">
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {h.column.getCanSort?.() && <ArrowUpDown className="h-3 w-3 text-slate-300" />}
                        </span>
                      </th>
                    ))}
                    <th className="tbl">Actions</th>
                  </tr>
                ))}
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="td">
                      <p className="font-medium">{r.employee.name}</p>
                      <p className="text-xs text-slate-400">
                        {r.employee.employeeNo} · {r.employee.position}
                      </p>
                    </td>
                    <td className="td">{r.employee.department.name}</td>
                    <td className="td">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="td tabular-nums">{r.arrivalAt ? fmtTime(r.arrivalAt) : '—'}</td>
                    <td className="td tabular-nums">{r.departureAt ? fmtTime(r.departureAt) : r.onSite ? 'on site' : '—'}</td>
                    <td className="td tabular-nums">{fmtMin(r.netMinutes)}</td>
                    <td className="td">
                      <span className={clsx('tabular-nums', r.lateMinutes > 0 ? 'font-semibold text-amber-600' : 'text-slate-400')}>
                        {r.lateMinutes ? `${r.lateMinutes}m` : '—'}
                      </span>
                    </td>
                    <td className="td text-xs text-slate-500">{r.employee.devices?.map((d) => d.name).join(', ') || '—'}</td>
                    <td className="td">
                      <div className="flex gap-1.5">
                        <button className="btn border border-slate-200 px-2 py-1 text-xs" onClick={() => setEvidenceId(r.id)}>
                          <Eye className="h-3.5 w-3.5" /> Evidence
                        </button>
                        {['SUPER_ADMIN', 'HR_ADMIN'].includes(user.role) && !r.departureAt && r.status !== 'ABSENT' && r.status !== 'ON_LEAVE' && r.status !== 'NOT_EXPECTED' && (
                          <button
                            className="btn border border-slate-200 px-2 py-1 text-xs"
                            disabled={r.onSite}
                            onClick={() => simulate.mutate({ employeeId: r.employee.id, kind: r.onSite ? 'departure' : 'arrival', at: promptTime() })}
                          >
                            {r.onSite ? 'Depart' : 'Arrive'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 text-xs text-slate-400">
        <RefreshCw className="h-3.5 w-3.5" /> Auto-refreshes every 5s and on network events.
        <button className="text-brand-600 hover:underline" onClick={invalidate}>
          Refresh now
        </button>
      </div>

      {evidenceId && <EvidenceDrawer recordId={evidenceId} onClose={() => setEvidenceId(null)} />}
    </div>
  );
}

function promptTime() {
  const t = window.prompt('Arrival time (HH:MM, org time, optional):');
  return t && /^\d{1,2}:\d{2}$/.test(t) ? t : undefined;
}

function EvidenceDrawer({ recordId, onClose }) {
  const { data, isLoading } = useQuery({
    queryKey: ['evidence', recordId],
    queryFn: () => api(`/attendance/${recordId}/evidence`),
  });

  return (
    <Modal open onClose={onClose} title="Attendance evidence" wide>
      {isLoading ? (
        <Spinner />
      ) : !data ? null : (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={data.record.status} />
            <span className="font-semibold">{data.record.employee.name}</span>
            <span className="text-slate-400">
              {data.record.employee.department.name} · {data.record.employee.employeeNo}
            </span>
            <span className="ml-auto text-xs text-slate-400">source: {data.record.source}</span>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kv k="Arrival" v={data.record.arrivalAt ? fmtTime(data.record.arrivalAt) : '—'} />
            <Kv k="Gross" v={fmtMin(data.evaluated.grossMinutes)} />
            <Kv k="Lunch mode" v={data.evaluated.lunchMode} />
            <Kv k="Net" v={fmtMin(data.evaluated.netMinutes)} />
            <Kv k="Late" v={data.evaluated.lateMinutes ? `${data.evaluated.lateMinutes}m` : '0m'} />
            <Kv k="Confirmed" v={data.evaluated.arrivalConfirmed ? 'within window' : 'manual review'} />
            <Kv k="On site" v={data.evaluated.onSite ? 'yes' : 'no'} />
            <Kv k="Lunch deducted" v={fmtMin(data.evaluated.lunchDeduction)} />
          </div>

          {data.evidence?.device && (
            <div className="rounded-lg bg-emerald-50 p-3 text-xs">
              <p className="font-semibold text-emerald-700">Device evidence</p>
              <div className="mt-1 space-y-0.5 text-emerald-700/80">
                <p>{data.evidence.device.name} ({data.evidence.device.type}) on {data.evidence.network}</p>
                <p>First seen {fmtTime(data.evidence.firstSeen)}</p>
                {data.evidence.segments?.length > 0 && (
                  <p>
                    On-site {data.evidence.segments.map((s) => `${fmtTime(s.start)} → ${fmtTime(s.end)}`).join(', ')}
                  </p>
                )}
              </div>
            </div>
          )}

          <div>
            <p className="mb-2 font-semibold">Detection timeline</p>
            {data.timeline.length === 0 ? (
              <p className="text-slate-400">No raw detections recorded for this day.</p>
            ) : (
              <div className="space-y-1.5">
                {data.timeline.map((ev, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                    <span className="font-medium">{ev.eventType}</span>
                    <span className="tabular-nums">{fmtTime(ev.at)}</span>
                    <span className="text-xs text-slate-500">{ev.network || 'Head Office'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {data.evaluated.segments?.length > 0 && (
            <div>
              <p className="mb-2 font-semibold">Shift segments</p>
              <div className="space-y-1.5">
                {data.evaluated.segments.map((s, i) => {
                  const mins = Math.round(((s.end ? new Date(s.end) : new Date()).getTime() - new Date(s.start).getTime()) / 60000);
                  return (
                    <div key={i} className="flex items-center justify-between text-xs text-slate-500">
                      <span>On site</span>
                      <span>
                        {fmtTime(s.start)} → {s.end ? fmtTime(s.end) : 'now'} · {fmtMin(mins)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {data.record.corrections?.length > 0 && (
            <div>
              <p className="mb-2 font-semibold">Corrections</p>
              {data.record.corrections.map((c) => (
                <div key={c.id} className="rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs">
                  <p className="font-medium text-indigo-700">{c.reason}</p>
                  <p className="text-indigo-600/70">
                    {c.actorName} · {new Date(c.createdAt).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function Kv({ k, v }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{k}</p>
      <p className="mt-0.5 text-sm font-medium">{v}</p>
    </div>
  );
}

void Download;