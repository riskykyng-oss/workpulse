import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileDown, Lock, Unlock, Hammer, CheckCircle2, AlertCircle, Search } from 'lucide-react';
import clsx from 'clsx';
import { api, apiBlob } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Spinner, Modal, useToast, StatCard } from '../components/ui';
import { fmtMin, fmtDate, fmtClock } from '../lib/format';

export default function Monthly() {
  const { user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const { data: periods, isLoading: pload } = useQuery({ queryKey: ['months'], queryFn: () => api('/monthly') });
  const current = periods?.periods?.find((p) => p.status === 'IN_PROGRESS')?.month || periods?.periods?.[0]?.month || '2026-09';
  const [month, setMonth] = useState(current);
  const [empQ, setEmpQ] = useState('');
  const [action, setAction] = useState(null); // {kind, reason}
  const [reason, setReason] = useState('');

  const { data, isLoading } = useQuery({ queryKey: ['monthly', month], queryFn: () => api(`/monthly/${month}`), enabled: !!month });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['monthly'] });
    qc.invalidateQueries({ queryKey: ['months'] });
  };

  const doAction = useMutation({
    mutationFn: (a) => {
      if (a.kind === 'compile') return api(`/monthly/${month}/compile`, { method: 'POST' });
      return api(`/monthly/${month}/${a.kind}`, { method: 'POST', body: { reason } });
    },
    onSuccess: () => {
      toast.success('Done.');
      setAction(null);
      setReason('');
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const exportCsv = async (fmt) => {
    try {
      await apiBlob(`/monthly/${month}/export?format=${fmt}`, `attendance-${month}.${fmt}`);
      toast.success('Export started.');
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (pload || isLoading) return <Spinner />;

  const isManager = user.role === 'MANAGER';
  const managerDept = user.employee?.department?.name;
  const company = data.company;
  const depts = isManager ? (data.departments || []).filter((d) => d.name === managerDept) : data.departments || [];
  const managerDeptId = data.departments?.find((d) => d.name === managerDept)?.id;
  const allEmp = data.employees || [];
  const scopedEmp = isManager ? allEmp.filter((e) => e.departmentId === managerDeptId) : allEmp;
  const emps = empQ
    ? scopedEmp.filter((e) => `${e.name} ${e.employeeNo} ${e.employeeId}`.toLowerCase().includes(empQ.toLowerCase()))
    : scopedEmp;

  const flags = data.flags || [];
  const status = data.status;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Monthly register</h1>
          <p className="text-sm text-slate-500">Aggregated attendance by employee, department and company.</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="input w-auto" value={month} onChange={(e) => setMonth(e.target.value)}>
            {(periods?.periods || []).map((p) => (
              <option key={p.month} value={p.month}>
                {p.month}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => exportCsv('csv')}>CSV</button>
            <button className="btn-secondary" onClick={() => exportCsv('xlsx')}>XLSX</button>
            <button className="btn-secondary" onClick={() => exportCsv('pdf')}>PDF</button>
          </div>
        </div>
      </div>

      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className={clsx('badge', status === 'IN_PROGRESS' ? 'bg-amber-100 text-amber-700' : status === 'READY_FOR_REVIEW' ? 'bg-sky-100 text-sky-700' : 'bg-emerald-100 text-emerald-700')}>
            {status === 'IN_PROGRESS' ? 'Open' : status === 'READY_FOR_REVIEW' ? 'Ready for review' : 'Closed'}
          </span>
          <span className="text-sm text-slate-500">
            {data.workingDays} working days · previous rate {data.previousCompanyRate ?? '—'}%
          </span>
          {status === 'CLOSED' && data.closedAt && (
            <span className="text-xs text-slate-400">
              closed by {data.closedBy || 'HR'} · {fmtDate(data.closedAt)}
            </span>
          )}
          {status === 'IN_PROGRESS' && data.reopenedReason && <span className="text-xs text-slate-400">reopened: {data.reopenedReason}</span>}
          {['SUPER_ADMIN', 'HR_ADMIN'].includes(user.role) && (
            <div className="ml-auto space-x-2">
              {status === 'IN_PROGRESS' && (
                <button className="btn-primary" onClick={() => setAction('compile')}>
                  <Hammer className="h-4 w-4" /> Compile
                </button>
              )}
              {status !== 'CLOSED' && (
                <button className="btn-secondary" onClick={() => setAction('close')}>
                  <Lock className="h-4 w-4" /> Lock & close
                </button>
              )}
              {status === 'CLOSED' && (
                <button className="btn-secondary" onClick={() => setAction('reopen')}>
                  <Unlock className="h-4 w-4" /> Reopen
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <StatCard icon={CheckCircle2} label="Attendance rate" value={`${company?.attendanceRate}%`} tone="violet" />
        <StatCard icon={CheckCircle2} label="Present days" value={company?.daysPresent} tone="emerald" sub="across register" />
        <StatCard icon={AlertCircle} label="Late days" value={company?.daysLate} tone="amber" />
        <StatCard icon={AlertCircle} label="Absences" value={company?.daysAbsent} tone="red" />
        <StatCard icon={AlertCircle} label="Corrections" value={company?.manualCorrections} tone="slate" />
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-700">Departments</h2>
          <span className="text-xs text-slate-400">
            avg net {company?.netMinutes ? fmtMin(Math.round(company.netMinutes / (company.daysPresent || 1))) : '—'}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="tbl">Department</th>
                <th className="tbl text-right">Present</th>
                <th className="tbl text-right">Late</th>
                <th className="tbl text-right">Absent</th>
                <th className="tbl text-right">Leave</th>
                <th className="tbl text-right">Not expected</th>
                <th className="tbl text-right">Net (h)</th>
                <th className="tbl text-right">Rate</th>
              </tr>
            </thead>
            <tbody>
              {depts.map((d) => (
                <tr key={d.id || d.name} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="td font-medium">{d.name}</td>
                  <td className="td text-right tabular-nums">{d.daysPresent}</td>
                  <td className="td text-right tabular-nums text-amber-600">{d.daysLate}</td>
                  <td className="td text-right tabular-nums text-red-600">{d.daysAbsent}</td>
                  <td className="td text-right tabular-nums text-sky-600">{d.daysLeave}</td>
                  <td className="td text-right tabular-nums">{d.daysNotExpected}</td>
                  <td className="td text-right tabular-nums">{d.netMinutes ? Math.round(d.netMinutes / 60) : '—'}</td>
                  <td className="td text-right font-semibold tabular-nums">{d.attendanceRate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-700">Employees ({emps.length})</h2>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input className="input w-64 pl-9" placeholder="Search employees…" value={empQ} onChange={(e) => setEmpQ(e.target.value)} />
          </div>
        </div>
        <div className="max-h-[480px] overflow-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-slate-50">
              <tr>
                <th className="tbl">Employee</th>
                <th className="tbl text-right">Present</th>
                <th className="tbl text-right">Late</th>
                <th className="tbl text-right">Absent</th>
                <th className="tbl text-right">Leave</th>
                <th className="tbl text-right">Net (h:m)</th>
                <th className="tbl text-right">Avg in</th>
                <th className="tbl text-right">Rate</th>
              </tr>
            </thead>
            <tbody>
              {emps.map((e) => (
                <tr key={e.employeeId} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="td">
                    <p className="font-medium">{e.name}</p>
                    <p className="text-xs text-slate-400">{e.employeeNo}</p>
                  </td>
                  <td className="td text-right tabular-nums text-emerald-600">{e.daysPresent}</td>
                  <td className="td text-right tabular-nums text-amber-600">{e.daysLate}</td>
                  <td className="td text-right tabular-nums text-red-600">{e.daysAbsent}</td>
                  <td className="td text-right tabular-nums text-sky-600">{e.daysLeave}</td>
                  <td className="td text-right tabular-nums">{fmtMin(e.netMinutes)}</td>
                  <td className="td text-right tabular-nums">{e.avgArrivalMinutes != null ? fmtClock(e.avgArrivalMinutes) : '—'}</td>
                  <td className="td text-right font-semibold tabular-nums">{e.attendanceRate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {flags.length > 0 && (
        <div className="card p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <AlertCircle className="h-4 w-4 text-amber-500" /> Review flags ({flags.length})
          </h2>
          <div className="max-h-[360px] space-y-2 overflow-y-auto">
            {flags.slice(0, 120).map((f) => (
              <div key={f.id} className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm">
                <span className="font-medium">{f.employee?.name || 'Employee'}</span>
                <span className="mx-2 text-amber-500">·</span>
                <span className="text-slate-600">{f.note || f.reason || 'Needs review'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {action && (
        <ActionModal
          kind={action}
          status={status}
          reason={reason}
          setReason={setReason}
          onCancel={() => setAction(null)}
          onConfirm={() => doAction.mutate(action)}
          busy={doAction.isPending}
        />
      )}
    </div>
  );
}

function ActionModal({ kind, status, reason, setReason, onCancel, onConfirm, busy }) {
  const labels = { compile: 'Compile the register', close: 'Lock & close this month', reopen: 'Reopen this month' };
  const needReason = kind === 'close' || kind === 'reopen';
  return (
    <Modal open onClose={onCancel} title={labels[kind]}>
      <p className="text-sm text-slate-600">
        {kind === 'compile' && 'Aggregates every employee into daily/monthly totals. Departments and company summaries are recomputed.'}
        {kind === 'close' && 'Closing locks the register. Employee changes are rejected while locked. The audit trail records who locked it.'}
        {kind === 'reopen' && 'Reopening allows further corrections. The reason is recorded in the audit trail.'}
      </p>
      {needReason && (
        <div className="mt-4">
          <label className="label">Reason (required)</label>
          <textarea className="input min-h-[72px]" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why are you changing the period status?" />
        </div>
      )}
      <p className="mt-3 text-xs text-slate-400">Period is currently {status}.</p>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button className={kind === 'close' ? 'btn-danger' : 'btn-primary'} disabled={busy || (needReason && !reason.trim())} onClick={onConfirm}>
          {busy ? 'Working…' : 'Confirm'}
        </button>
      </div>
    </Modal>
  );
}

void FileDown;