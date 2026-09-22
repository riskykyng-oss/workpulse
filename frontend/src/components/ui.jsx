import { X } from 'lucide-react';
import { useState, useMemo, useEffect, useRef, useContext, createContext } from 'react';
import clsx from 'clsx';
import { StatusBadge } from '../lib/format';

export { StatusBadge };

export function Spinner({ className = '' }) {
  return (
    <div className={`flex items-center justify-center p-8 text-slate-400 ${className}`}>
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
    </div>
  );
}

export function StatCard({ icon: Icon, label, value, sub, tone = 'slate' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-600',
    emerald: 'bg-emerald-100 text-emerald-600',
    amber: 'bg-amber-100 text-amber-600',
    red: 'bg-red-100 text-red-600',
    sky: 'bg-sky-100 text-sky-600',
    violet: 'bg-violet-100 text-violet-600',
  };
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <div className={`rounded-lg p-2 ${tones[tone] || tones.slate}`}>{Icon && <Icon className="h-4 w-4" />}</div>
      </div>
      <p className="mt-2 text-3xl font-bold tabular-nums">{value ?? '—'}</p>
      {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className={clsx('card max-h-[90vh] w-full overflow-y-auto p-5', wide ? 'max-w-3xl' : 'max-w-lg')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
          <button className="rounded p-1 text-slate-400 hover:bg-slate-100" onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <div>{children}</div>
        {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useMemo(
    () => ({
      success: (msg) => setToasts((t) => [...t, { id: Date.now() + Math.random(), msg, kind: 'success' }]),
      error: (msg) => setToasts((t) => [...t, { id: Date.now() + Math.random(), msg, kind: 'error' }]),
    }),
    [],
  );
  useEffect(() => {
    const t = setTimeout(() => setToasts((all) => all.slice(1)), 4200);
    return () => clearTimeout(t);
  }, [toasts.length]);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={clsx('pointer-events-auto rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg', t.kind === 'success' ? 'bg-emerald-600' : 'bg-red-600')}
          >
            {t.msg}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const ToastContext = createContext(null);
export function useToast() {
  return useContext(ToastContext);
}

export function useMount(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const cleanup = ref.current();
    if (typeof cleanup === 'function') return cleanup;
  }, []);
}

export function Empty({ text = 'Nothing here yet.' }) {
  return <div className="py-10 text-center text-sm text-slate-400">{text}</div>;
}