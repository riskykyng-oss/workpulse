import { useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { Activity, Lock, Mail } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ui';

const DEMO = [
  { label: 'HR admin', email: 'admin@harcourt.co.zw', password: 'workpulse' },
  { label: 'Super admin', email: 'root@harcourt.co.zw', password: 'workpulse' },
  { label: 'Manager', email: 'sarah.ncube@harcourt.co.zw', password: 'workpulse' },
  { label: 'Employee', email: 'tendai.chikore@harcourt.co.zw', password: 'workpulse' },
];

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={user.role === 'EMPLOYEE' ? '/me' : '/'} replace />;

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const u = await login(email.trim(), password);
      navigate(u.role === 'EMPLOYEE' ? '/me' : '/', { replace: true });
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-brand-900 p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-2xl font-extrabold text-white">
            W
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">WorkPulse</h1>
          <p className="mt-1 text-sm text-slate-300">Know who's at work. Automatically.</p>
        </div>
        <form onSubmit={submit} className="card p-6">
          <h2 className="mb-4 text-lg font-semibold">Sign in</h2>
          {error && <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
          <label className="label">Email</label>
          <div className="relative mb-4">
            <Mail className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input className="input pl-9" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@harcourt.co.zw" required autoFocus />
          </div>
          <label className="label">Password</label>
          <div className="relative mb-4">
            <Lock className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input className="input pl-9" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
          </div>
          <button className="btn-primary w-full py-2.5" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <div className="mt-5 border-t border-slate-100 pt-4">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-400">
              <Activity className="h-3.5 w-3.5" /> Demo accounts (password: workpulse)
            </p>
            <div className="grid grid-cols-2 gap-2">
              {DEMO.map((d) => (
                <button
                  type="button"
                  key={d.email}
                  className="btn border border-slate-200 text-xs hover:bg-slate-50"
                  onClick={() => {
                    setEmail(d.email);
                    setPassword(d.password);
                  }}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}