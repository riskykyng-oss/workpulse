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
  Menu,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../auth/AuthContext';
import { useRealtime } from '../socket';
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

const BOTTOM_MAX = 4;

export default function Shell() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [clock, setClock] = useState(nowOrgHourMin());
  const [network, setNetwork] = useState({ status: 'online', connectedDevices: 0 });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setClock(nowOrgHourMin()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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
  const bottomTabs = items.slice(0, BOTTOM_MAX);

  return (
    <div className="flex h-[100dvh] overflow-hidden">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <Brand />
        <NavList items={items} />
        <UserFooter user={user} displayName={displayName} initials={initials} onLogout={logout} />
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-3 md:hidden">
          <div className="flex items-center gap-2">
            <button
              aria-label="Open navigation"
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
              onClick={() => setOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">W</div>
            <span className="text-sm font-bold tracking-tight">WorkPulse</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className={clsx('h-2 w-2 rounded-full', online ? 'bg-emerald-500' : 'bg-red-500')} />
            <Clock className="h-4 w-4" />
            <span className="font-mono tabular-nums">{clock}</span>
          </div>
        </header>

        <header className="hidden h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 md:flex">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="font-semibold text-slate-700">Head Office network</span>
            {online ? <Wifi className="h-4 w-4 text-emerald-500" /> : <WifiOff className="h-4 w-4 text-red-500" />}
            <span className={online ? 'text-emerald-600' : 'text-red-600'}>{online ? 'online' : 'offline'}</span>
            {network.connectedDevices > 0 && (
              <span className="text-slate-400">· {network.connectedDevices} devices in the last minute</span>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Clock className="h-4 w-4" />
            <span className="font-mono tabular-nums">{clock}</span>
            <span className="text-xs text-slate-400">Africa/Harare</span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-3 pb-20 sm:p-6 sm:pb-20 md:pb-6">
          <Outlet />
        </main>

        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white md:hidden" aria-label="Primary">
          {bottomTabs.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                clsx(
                  'flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium',
                  isActive ? 'text-brand-600' : 'text-slate-400',
                )
              }
            >
              <Icon className="h-5 w-5" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div
          className={clsx(
            'fixed inset-0 z-50 bg-black/40 transition-opacity md:hidden',
            open ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
          onClick={() => setOpen(false)}
        >
          <div
            className={clsx(
              'flex h-full w-64 shrink-0 flex-col bg-white shadow-xl transition-transform',
              open ? 'translate-x-0' : '-translate-x-full',
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-4">
              <Brand />
              <button
                aria-label="Close navigation"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
                onClick={() => setOpen(false)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <NavList items={items} onNavigate={() => setOpen(false)} />
            <UserFooter user={user} displayName={displayName} initials={initials} onLogout={logout} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 font-bold text-white">W</div>
      <div>
        <p className="text-sm font-bold tracking-tight">WorkPulse</p>
        <p className="text-[11px] text-slate-400">Harcourt Group · HQ</p>
      </div>
    </div>
  );
}

function NavList({ items, onNavigate }) {
  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          onClick={onNavigate}
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
  );
}

function UserFooter({ user, displayName, initials, onLogout }) {
  return (
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
      <button className="btn w-full border border-slate-200 text-slate-600 hover:bg-slate-50" onClick={onLogout}>
        <LogOut className="h-4 w-4" /> Sign out
      </button>
    </div>
  );
}