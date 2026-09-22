import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { ToastProvider } from './components/ui';
import Shell from './components/Shell';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import LiveRegister from './pages/LiveRegister';
import Departments from './pages/Departments';
import Rules from './pages/Rules';
import Monthly from './pages/Monthly';
import Employees from './pages/Employees';
import Devices from './pages/Devices';
import Audit from './pages/Audit';
import Me from './pages/Me';

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

export default function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <BrowserRouter>
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
          </BrowserRouter>
        </ToastProvider>
      </QueryClientProvider>
    </AuthProvider>
  );
}