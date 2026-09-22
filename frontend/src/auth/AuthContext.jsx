import { createContext, useContext, useMemo, useState, useCallback } from 'react';
import { api, saveSession, clearSession, loadSession } from '../api/client';
import { connectSocket, disconnectSocket } from '../socket';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(() => loadSession());

  const login = useCallback(async (email, password) => {
    const data = await api('/auth/login', { method: 'POST', body: { email, password } });
    const next = { token: data.token, user: data.user };
    saveSession(next);
    setSession(next);
    connectSocket();
    return data.user;
  }, []);

  const logout = useCallback(() => {
    disconnectSocket();
    clearSession();
    setSession(null);
  }, []);

  const value = useMemo(
    () => ({
      session,
      user: session?.user || null,
      token: session?.token || null,
      login,
      logout,
    }),
    [session, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}