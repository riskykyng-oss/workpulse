import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../api/client';
import { Spinner, Empty } from '../components/ui';

export default function Audit() {
  const [action, setAction] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['audit', action],
    queryFn: () => api('/audit', { params: { action: action || undefined } }),
  });

  if (isLoading) return <Spinner />;
  const logs = data?.logs || [];
  const actions = data?.actions || [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <ScrollText className="h-5 w-5 text-slate-400" /> Audit log
        </h1>
        <p className="text-sm text-slate-500">Every rule change, correction, compile, close and demo action is recorded.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          className={clsx('btn border text-xs', action === '' ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300 text-slate-600')}
          onClick={() => setAction('')}
        >
          All
        </button>
        {actions.map((a) => (
          <button
            key={a}
            className={clsx('btn border text-xs', action === a ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300 text-slate-600')}
            onClick={() => setAction(a)}
          >
            {a}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        {logs.length === 0 ? (
          <Empty text="No audit events." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="tbl">When</th>
                  <th className="tbl">Action</th>
                  <th className="tbl">Actor</th>
                  <th className="tbl">Target</th>
                  <th className="tbl">Reason</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="td whitespace-nowrap tabular-nums text-slate-500">
                      {new Date(l.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="td">
                      <span className="badge bg-slate-100 font-mono text-[11px] text-slate-600">{l.action}</span>
                    </td>
                    <td className="td font-medium">{l.actorName}</td>
                    <td className="td text-slate-500">
                      {l.targetType ? `${l.targetType}${l.targetId ? ` · ${l.targetId.slice(0, 8)}` : ''}` : '—'}
                    </td>
                    <td className="td max-w-[340px] truncate text-slate-600">
                      {l.reason || (l.detail ? JSON.stringify(l.detail) : '—')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}