import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, Users, UserCheck, Clock, UserX, ArrowRight } from 'lucide-react';
import { api } from '../api/client';
import { Spinner, Modal } from '../components/ui';
import { StatusBadge, fmtTime } from '../lib/format';

export default function Departments() {
  const { data, isLoading } = useQuery({ queryKey: ['departments'], queryFn: () => api('/departments') });
  const [openId, setOpenId] = useState(null);
  const [, setRoster] = useState(null);

  function openRoster(dept) {
    setOpenId(dept.id);
    setRoster(null);
  }

  const { data: live } = useQuery({
    queryKey: ['live'],
    queryFn: () => api('/attendance/live'),
    enabled: !!openId,
  });

  if (isLoading) return <Spinner />;
  const depts = data?.departments || [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">Departments</h1>
        <p className="text-sm text-slate-500">Headcount, managers and today&apos;s attendance by department.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {depts.map((d) => (
          <button key={d.id} className="card p-5 text-left transition hover:border-brand-300 hover:shadow" onClick={() => openRoster(d)}>
            <div className="flex items-center justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                <Building2 className="h-5 w-5" />
              </div>
              <span className="badge bg-slate-100 text-slate-600">{d.attendanceRate}%</span>
            </div>
            <h3 className="mt-3 text-base font-semibold">{d.name}</h3>
            <p className="text-xs text-slate-400">Manager: {d.manager?.name || '—'}</p>
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <div className="flex items-center gap-1.5 text-slate-600">
                <Users className="h-4 w-4 text-slate-400" /> {d.headcount}
              </div>
              <div className="flex items-center gap-1.5 text-emerald-600">
                <UserCheck className="h-4 w-4" /> {d.present}
              </div>
              <div className="flex items-center gap-1.5 text-amber-600">
                <Clock className="h-4 w-4" /> {d.late}
              </div>
              <div className="flex items-center gap-1.5 text-red-600">
                <UserX className="h-4 w-4" /> {d.absent}
              </div>
            </div>
            <p className="mt-3 flex items-center gap-1 text-xs font-medium text-brand-600">
              View roster <ArrowRight className="h-3 w-3" />
            </p>
          </button>
        ))}
      </div>

      <Modal open={!!openId} onClose={() => setOpenId(null)} title={depts.find((d) => d.id === openId)?.name + ' — today\'s roster'} wide>
        {!live ? (
          <Spinner />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="tbl">Employee</th>
                  <th className="tbl">Status</th>
                  <th className="tbl">Arrival</th>
                  <th className="tbl">Departure</th>
                  <th className="tbl">Net</th>
                </tr>
              </thead>
              <tbody>
                {(live.records || []).map((r) => (
                  <tr key={r.id} className="border-b border-slate-50">
                    <td className="td font-medium">
                      {r.employee.name}
                      <span className="ml-2 text-xs text-slate-400">{r.employee.position}</span>
                    </td>
                    <td className="td">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="td tabular-nums">{r.arrivalAt ? fmtTime(r.arrivalAt) : '—'}</td>
                    <td className="td tabular-nums">{r.departureAt ? fmtTime(r.departureAt) : '—'}</td>
                    <td className="td tabular-nums">{r.netMinutes ?? '—'}m</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
}