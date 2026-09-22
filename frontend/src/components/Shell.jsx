import { useEffect, useState } from 'react';
import { NavLink, Outlet, Navigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Radio,
  Building2,
  SlidersHorizontal,
  CalendarRange,
  Users,
  Smartphone,
  ScrollText,
  LogOut,
  Clock,
  Wifi,
  WifiOff,
  UserCircle,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../auth/AuthContext';
import { useRealtime, socket } from '../socket';
import { nowOrgHourMin } from '../lib/format';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, roles: ['SUPER_ADMIN', 'HR_ADMIN', 'MANAGER', 'VIEWER'] },
  { to: '/live', label: 'Live register', icon: Radio, roles: ['SUPER_ADMIN', 'HR_ADMIN', 'MANAGER', 'VIEWER'] },
  { to: '/departments', label: 'Departments', icon: Building2, roles: ['SUPER_ADMIN', 'HR_ADMIN', 'MANAGER'] },
  { to: '/rules', label: 'Rules', icon: SlidersHorizontal, roles: ['SUPER_ADMIN', 'HR_ADMIN'] },
  { to: '/monthly', label: 'Monthly', icon: CalendarRange, roles: ['SUPER_ADMIN', 'HR_ADMIN', 'VIEWER'] },
  { to: '/employees', label: 'Employees', icon: Users, roles: ['SUPER_ADMIN', 'HR_ADMIN', 'MANAGER'] },
  { to: '/devices', label: 'Devices', icon: Smartphone, roles: ['SUPER_ADMIN', 'HR_ADMIN', 'MANAGER'] },
  { to: '/audit', label: 'Audit log', icon: ScrollText, roles: ['SUPER_ADMIN', 'HR_ADMIN'] },
  { to: '/me', label: 'My day', icon: UserCircle, roles: ['EMPLOYEE', 'SUPER_ADMIN', 'HR_ADMIN', 'MANAGER', 'VIEWER'] },
];

export default function Shell() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [clock, setClock] = useState(nowOrgHourMin());
  const [network, setNetwork] = useState({ status: 'online', connectedDevices: 0 });

  useEffect(() => {
    const t = setInterval(() => setClock(nowOrgHourMin()), 1000);
    return () => clearInterval(t);
  }, []);

  useRealtime({
    'network:status': (p) => setNetwork(p),
  });

  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;

  const displayName = user.employee?.name || user.email || 'User';
  const initials = displayName
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const items = NAV.filter((n) => n.roles.includes(user.role));
  const online = network.status !== 'offline';

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 font-bold text-white">W</div>
          <div>
            <p className="text-sm font-bold tracking-tight">WorkPulse</p>
            <p className="text-[11px] text-slate-400">Harcourt Group · HQ</p>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                  isActive ? 'bg-slate-100 text-brand-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-100 p-3">
          <div className="mb-3 flex items-center gap-3 px-1">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-sm font-bold text-brand-700">
              {initials || 'U'}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{displayName}</p>
              <p className="text-[11px] text-slate-400">{user.role.replaceAll('_', ' ').toLowerCase()}</p>
            </div>
          </div>
          <button className="btn w-full border border-slate-200 text-slate-600 hover:bg-slate-50" onClick={logout}>
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="font-semibold text-slate-700">Head Office network</span>
            {online ? <Wifi className="h-4 w-4 text-emerald-500" /> : <WifiOff className="h-4 w-4 text-red-500" />}
            <span className={online ? 'text-emerald-600' : 'text-red-600'}>{online ? 'online' : 'offline'}</span>
            {network.connectedDevices > 0 && <span className="text-slate-400">· {network.connectedDevices} devices in the last minute</span>}
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Clock className="h-4 w-4" />
            <span className="font-mono tabular-nums">{clock}</span>
            <span className="text-xs text-slate-400">Africa/Harare</span>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}