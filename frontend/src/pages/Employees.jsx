import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Smartphone, Clock, CalendarCheck2, CalendarX2 } from 'lucide-react';
import { api } from '../api/client';
import { Spinner, Modal, Empty } from '../components/ui';
import { StatusBadge, fmtTime, fmtMin, fmtDate } from '../lib/format';

export default function Employees() {
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [openId, setOpenId] = useState(null);

  const { data, isLoading } = useQuery({ queryKey: ['employees'], queryFn: () => api('/employees') });

  const depts = useMemo(() => [...new Set((data?.employees || []).map((e) => e.department.name))].sort(), [data]);
  const rows = (data?.employees || []).filter((e) => {
    if (dept && e.department.name !== dept) return false;
    if (q && !`${e.name} ${e.employeeNo} ${e.email}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  if (isLoading) return <Spinner />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Employees</h1>
        <p className="text-sm text-slate-500">{data?.count || rows.length} people on the register.</p>
      </div>

      <div className="card flex flex-wrap items-center gap-3 p-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input className="input pl-9" placeholder="Search name, no or email…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input w-auto" value={dept} onChange={(e) => setDept(e.target.value)}>
          <option value="">All departments</option>
          {depts.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
      </div>

      <div className="card overflow-hidden">
        {rows.length === 0 ? (
          <Empty text="No employees match." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="tbl">Name</th>
                  <th className="tbl">No</th>
                  <th className="tbl">Department</th>
                  <th className="tbl">Position</th>
                  <th className="tbl">Type</th>
                  <th className="tbl">Devices</th>
                  <th className="tbl">Primary device</th>
                  <th className="tbl">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} className="cursor-pointer border-b border-slate-50 hover:bg-slate-50" onClick={() => setOpenId(e.id)}>
                    <td className="td font-medium">{e.name}</td>
                    <td className="td text-slate-500">{e.employeeNo}</td>
                    <td className="td">{e.department?.name}</td>
                    <td className="td text-slate-600">{e.position}</td>
                    <td className="td">
                      <span className="badge bg-slate-100 text-slate-600">{e.employmentType}</span>
                    </td>
                    <td className="td tabular-nums">{e.deviceCount}</td>
                    <td className="td text-slate-500">{e.primaryDevice?.name || '—'}</td>
                    <td className="td">
                      <span className={`badge ${e.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{e.active ? 'Active' : 'Inactive'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {openId && <EmployeeDrawer employeeId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function EmployeeDrawer({ employeeId, onClose }) {
  const { data, isLoading } = useQuery({
    queryKey: ['employee', employeeId],
    queryFn: () => api(`/employees/${employeeId}`),
  });

  return (
    <Modal open onClose={onClose} title="Employee detail" wide>
      {isLoading || !data ? (
        <Spinner />
      ) : (
        <div className="space-y-5 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-lg font-bold text-brand-700">
              {data.employee.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
            </div>
            <div>
              <p className="text-base font-semibold">{data.employee.name}</p>
              <p className="text-slate-500">
                {data.employee.department.name} · {data.employee.position} · {data.employee.employmentType}
              </p>
            </div>
            <div className="ml-auto space-x-2">
              <span className="badge bg-slate-100 text-slate-600">{data.employee.employeeNo}</span>
              {data.employee.user && <span className="badge bg-brand-50 text-brand-700">has login</span>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Chip icon={CalendarCheck2} label="Present (month)" value={data.summary.daysPresent} tone="emerald" />
            <Chip icon={Clock} label="Late (month)" value={data.summary.daysLate} tone="amber" />
            <Chip icon={CalendarX2} label="Absent (month)" value={data.summary.daysAbsent} tone="red" />
            <Chip icon={Clock} label="Net (month)" value={fmtMin(data.summary.netMinutes)} tone="slate" />
          </div>

          <section>
            <h3 className="mb-2 flex items-center gap-1.5 font-semibold">
              <Smartphone className="h-4 w-4 text-brand-500" /> Devices ({data.employee.devices.length})
            </h3>
            {data.employee.devices.length === 0 ? (
              <p className="text-slate-400">No registered device — attendance must come from the network feed.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="tbl">Name</th>
                      <th className="tbl">Type</th>
                      <th className="tbl">OS</th>
                      <th className="tbl">Primary</th>
                      <th className="tbl">Last seen</th>
                      <th className="tbl">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.employee.devices.map((d) => (
                      <tr key={d.id} className="border-b border-slate-50">
                        <td className="td font-medium">{d.name}</td>
                        <td className="td">{d.type}</td>
                        <td className="td">{d.os}</td>
                        <td className="td">{d.isPrimary ? <span className="badge bg-brand-50 text-brand-700">primary</span> : '—'}</td>
                        <td className="td tabular-nums">{d.lastSeenAt ? fmtTime(d.lastSeenAt) : '—'}</td>
                        <td className="td">{d.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section>
            <h3 className="mb-2 font-semibold">Recent attendance</h3>
            {data.recent.length === 0 ? (
              <p className="text-slate-400">No records yet.</p>
            ) : (
              <div className="max-h-[300px] overflow-auto">
                <table className="w-full">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr>
                      <th className="tbl">Date</th>
                      <th className="tbl">Status</th>
                      <th className="tbl">Arrival</th>
                      <th className="tbl">Departure</th>
                      <th className="tbl">Net</th>
                      <th className="tbl">Late</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.map((r) => (
                      <tr key={r.id} className="border-b border-slate-50">
                        <td className="td tabular-nums">{fmtDate(r.date)}</td>
                        <td className="td">
                          <StatusBadge status={r.status} />
                        </td>
                        <td className="td tabular-nums">{r.arrivalAt ? fmtTime(r.arrivalAt) : '—'}</td>
                        <td className="td tabular-nums">{r.departureAt ? fmtTime(r.departureAt) : '—'}</td>
                        <td className="td tabular-nums">{fmtMin(r.netMinutes)}</td>
                        <td className="td tabular-nums">{r.lateMinutes ? `${r.lateMinutes}m` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}

function Chip({ icon: Icon, label, value, tone }) {
  const tones = { emerald: 'text-emerald-600', amber: 'text-amber-600', red: 'text-red-600', slate: 'text-slate-600' };
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-0.5 flex items-center gap-1 text-lg font-semibold ${tones[tone]}`}>
        <Icon className="h-4 w-4" /> {value}
      </p>
    </div>
  );
}