import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Info } from 'lucide-react';
import { api } from '../api/client';
import { Spinner, useToast } from '../components/ui';

const GRID = [
  ['workStartMinutes', 'Work start', 'minutes since midnight'],
  ['workEndMinutes', 'Work end', 'minutes since midnight'],
  ['lateThresholdMinutes', 'Late threshold', 'arrival from (minutes)'],
  ['absentCutoffMinutes', 'Absent cutoff', 'marked absent from (minutes)'],
  ['confirmationWindowMinutes', 'Confirmation window', 'min to confirm arrival'],
  ['disconnectBridgeMinutes', 'Disconnect bridge', 'min gap bridged'],
  ['departureGraceMinutes', 'Departure grace', 'min'],
  ['lunchStartMinutes', 'Lunch start', 'minutes since midnight'],
  ['lunchEndMinutes', 'Lunch end', 'minutes since midnight'],
  ['lunchMinMinutes', 'Lunch min (HYBRID)', 'min'],
  ['lunchMaxMinutes', 'Lunch max (HYBRID)', 'min'],
  ['lunchFixedMinutes', 'Lunch fixed (FIXED)', 'min'],
];

export default function Rules() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['rules'], queryFn: () => api('/rules') });
  const [form, setForm] = useState({});
  const [reason, setReason] = useState('');
  const [dirty, setDirty] = useState(false);

  const save = useMutation({
    mutationFn: (body) => api('/rules', { method: 'PUT', body }),
    onSuccess: () => {
      toast.success('Rules saved — today re-evaluated.');
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['rules'] });
      qc.invalidateQueries({ queryKey: ['live'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) return <Spinner />;
  const rules = data.rules;
  const preview = data.preview;
  const show = (k) => (form[k] ?? rules[k]) === '' ? rules[k] : form[k] ?? rules[k];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">Attendance rules</h1>
        <p className="text-sm text-slate-500">Change how attendance is interpreted. Saved changes re-run today through the engine.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <h2 className="mb-4 text-sm font-semibold">Working hours & thresholds</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            {GRID.map(([k, label, hint]) => (
              <div key={k}>
                <label className="label">{label}</label>
                <input
                  type="number"
                  className="input"
                  value={show(k)}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, [k]: e.target.value }));
                    setDirty(true);
                  }}
                />
                {hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
              </div>
            ))}
          </div>

          <div className="mt-5 border-t border-slate-100 pt-5">
            <label className="label">Lunch policy</label>
            <select className="input" value={form.lunchMode ?? rules.lunchMode} onChange={(e) => { setForm((f) => ({ ...f, lunchMode: e.target.value })); setDirty(true); }}>
              <option value="HYBRID">Hybrid — deduct detected off-network time clamped to min/max</option>
              <option value="FIXED">Fixed — always deduct the fixed lunch minutes</option>
              <option value="DETECTED">Detected only — deduct actual time, no minimum</option>
            </select>
            <p className="mt-2 text-xs text-slate-400">Current mode: {rules.lunchMode}.</p>
          </div>

          <div className="mt-5 border-t border-slate-100 pt-5">
            <label className="label">Change reason (audit trail)</label>
            <textarea className="input min-h-[72px]" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Adopt 60-min fixed lunch from next month" />
          </div>

          <div className="mt-5 flex gap-2">
            <button
              className="btn-primary"
              disabled={save.isPending}
              onClick={() => {
                const body = { ...form, reason };
                const n = {};
                for (const [k, v] of Object.entries(body)) n[k] = v === '' ? undefined : v;
                save.mutate(n);
              }}
            >
              <Save className="h-4 w-4" /> {save.isPending ? 'Re-evaluating…' : 'Save rules'}
            </button>
            {!dirty && (
              <button className="btn-secondary" onClick={() => toast.success('No changes to save.')}>
                No changes
              </button>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="card p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Info className="h-4 w-4 text-brand-500" /> Live preview
            </h2>
            <div className="space-y-3 text-sm">
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs font-medium text-slate-400">Late starts</p>
                <p className="mt-1 font-semibold">
                  Arrival at {preview?.lateThresholdLabel} or later is <span className="text-amber-600">Late</span>
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  An 08:12 arrival with these rules → {preview?.isLate ? 'LATE' : 'PRESENT'} (real engine evaluation).
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs font-medium text-slate-400">Lunch deduction</p>
                <p className="mt-1 font-semibold">
                  {preview?.lunchMode === 'FIXED' ? `Always ${preview?.lunchLabel}` : `${preview?.lunchLabel}`}
                </p>
                <p className="mt-1 text-xs text-slate-500">25-min break example → {preview?.lunchDeductionOn25} min deducted.</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs font-medium text-slate-400">Absence</p>
                <p className="mt-1 text-xs text-slate-500">No arrival by the absent cutoff = absent until corrected.</p>
              </div>
            </div>
          </div>

          <div className="card p-5">
            <h2 className="mb-2 text-sm font-semibold">Active values</h2>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              {GRID.map(([k, label]) => (
                <div key={k} className="flex justify-between">
                  <dt className="text-slate-400">{label}</dt>
                  <dd className="font-medium tabular-nums">{rules[k]}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-slate-400">
              retention: {rules.retentionDays ?? data?.rules.retentionDays ?? 365} days · notify {rules.notifyWeeks || 'n/a'} weeks ahead
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}