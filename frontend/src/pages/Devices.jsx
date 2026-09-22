import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Star, StarOff } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../api/client';
import { Spinner, Modal, useToast } from '../components/ui';
import { fmtTime, fmtDate } from '../lib/format';

export default function Devices() {
  const toast = useToast();
  const qc = useQueryClient();
  const [show, setShow] = useState(false);

  const { data, isLoading } = useQuery({ queryKey: ['devices'], queryFn: () => api('/devices') });
  const { data: employees } = useQuery({ queryKey: ['employees', 'for-devices'], queryFn: () => api('/employees?limit=1000') });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['devices'] });

  const setPrimary = useMutation({
    mutationFn: (id) => api(`/devices/${id}/primary`, { method: 'PATCH' }),
    onSuccess: () => { toast.success('Primary device updated.'); invalidate(); },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) return <Spinner />;
  const devices = data?.devices || [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Devices</h1>
          <p className="text-sm text-slate-500">
            {devices.length} registered · {data?.noDeviceCount} employees without a device.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShow(true)}>
          <Plus className="h-4 w-4" /> Register device
        </button>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="tbl">Device</th>
                <th className="tbl">Type / OS</th>
                <th className="tbl">Owner</th>
                <th className="tbl">Department</th>
                <th className="tbl">Identity</th>
                <th className="tbl">Last seen</th>
                <th className="tbl">Status</th>
                <th className="tbl">Primary</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="td font-medium">{d.name}</td>
                  <td className="td text-slate-500">
                    {d.type} · {d.os}
                  </td>
                  <td className="td">{d.employee.name}</td>
                  <td className="td">{d.employee.department}</td>
                  <td className="td font-mono text-xs text-slate-400">{d.identifier}</td>
                  <td className="td tabular-nums">{d.lastSeenAt ? fmtTime(d.lastSeenAt) : '—'}</td>
                  <td className="td">
                    <span className={clsx('badge', d.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700')}>{d.status}</span>
                  </td>
                  <td className="td">
                    <button
                      className="btn px-2 py-1 text-xs"
                      disabled={d.isPrimary}
                      onClick={() => setPrimary.mutate(d.id)}
                      title={d.isPrimary ? 'Primary' : 'Make primary'}
                    >
                      {d.isPrimary ? <Star className="h-4 w-4 text-amber-400" /> : <StarOff className="h-4 w-4 text-slate-300" />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {show && (
        <RegisterModal
          employees={(employees?.employees || []).filter((e) => e.active)}
          onClose={() => setShow(false)}
          onDone={() => { setShow(false); invalidate(); }}
        />
      )}
    </div>
  );
}

function RegisterModal({ employees, onClose, onDone }) {
  const toast = useToast();
  const [form, setForm] = useState({ employeeId: '', name: '', type: 'PHONE', os: 'iOS' });
  const reg = useMutation({
    mutationFn: (body) => api('/devices', { method: 'POST', body }),
    onSuccess: () => { toast.success('Device registered.'); onDone(); },
    onError: (err) => toast.error(err.message),
  });
  return (
    <Modal open onClose={onClose} title="Register a device">
      <p className="mb-4 text-sm text-slate-500">Associate a companion device with an employee so their network detections can be attributed.</p>
      <div className="space-y-4">
        <div>
          <label className="label">Employee</label>
          <select className="input" value={form.employeeId} onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))}>
            <option value="">Choose…</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} — {e.employeeNo}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Device name</label>
            <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Phone" />
          </div>
          <div>
            <label className="label">Type</label>
            <select className="input" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
              <option>PHONE</option>
              <option>LAPTOP</option>
              <option>TABLET</option>
              <option>BADGE</option>
            </select>
          </div>
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={!form.employeeId || reg.isPending} onClick={() => reg.mutate(form)}>
          {reg.isPending ? 'Saving…' : 'Register'}
        </button>
      </div>
    </Modal>
  );
}

void StarOff;
void fmtDate;