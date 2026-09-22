import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { ToastProvider } from './components/ui';
import Shell from './components/Shell';
import Login from './pages/Login';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const LiveRegister = lazy(() => import('./pages/LiveRegister'));
const Departments = lazy(() => import('./pages/Departments'));
const Rules = lazy(() => import('./pages/Rules'));
const Monthly = lazy(() => import('./pages/Monthly'));
const Employees = lazy(() => import('./pages/Employees'));
const Devices = lazy(() => import('./pages/Devices'));
const Audit = lazy(() => import('./pages/Audit'));
const Me = lazy(() => import('./pages/Me'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 },
  },
});

function RequireRole({ roles, children }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (!roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

function RouteFallback() {
  return (
    <div className="flex items-center justify-center py-24 text-sm text-slate-400">
      Loading…
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <BrowserRouter>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route element={<Shell />}>
                  <Route path="/" element={<RequireRole roles={['SUPER_ADMIN', 'HR_ADMIN', 'MANAGER', 'VIEWER']}><Dashboard /></RequireRole>} />
                  <Route path="/live" element={<RequireRole roles={['SUPER_ADMIN', 'HR_ADMIN', 'MANAGER', 'VIEWER']}><LiveRegister /></RequireRole>} />
                  <Route path="/departments" element={<RequireRole roles={['SUPER_ADMIN', 'HR_ADMIN', 'MANAGER']}><Departments /></RequireRole>} />
                  <Route path="/rules" element={<RequireRole roles={['SUPER_ADMIN', 'HR_ADMIN']}><Rules /></RequireRole>} />
                  <Route path="/monthly" element={<RequireRole roles={['SUPER_ADMIN', 'HR_ADMIN', 'VIEWER']}><Monthly /></RequireRole>} />
                  <Route path="/employees" element={<RequireRole roles={['SUPER_ADMIN', 'HR_ADMIN', 'MANAGER']}><Employees /></RequireRole>} />
                  <Route path="/devices" element={<RequireRole roles={['SUPER_ADMIN', 'HR_ADMIN', 'MANAGER']}><Devices /></RequireRole>} />
                  <Route path="/audit" element={<RequireRole roles={['SUPER_ADMIN', 'HR_ADMIN']}><Audit /></RequireRole>} />
                  <Route path="/me" element={<Me />} />
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </ToastProvider>
      </QueryClientProvider>
    </AuthProvider>
  );
}