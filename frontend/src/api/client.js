const SESSION_KEY = 'workpulse_session';
// The JWT lives in localStorage so the socket handshake and every fetch can
// reuse it without a round-trip. Trade-off: any XSS can read it. The secure
// alternative is an httpOnly cookie + CSRF token — deferred because this SPA
// serves no HTML-crafting endpoints yet (all responses are JSON via fetch).

export function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

export function getToken() {
  return loadSession()?.token || null;
}

export async function api(path, { method = 'GET', body, params } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let url = `/api${path}`;
  if (params) {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    if (qs) url += `?${qs}`;
  }
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const ct = res.headers.get('content-type') || '';
  if (!res.ok) {
    let msg = 'Something went wrong on our side. Please try again.';
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch {
      /* keep default */
    }
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  if (ct.includes('json')) return res.json();
  const text = await res.text();
  return { text, headers: res.headers };
}

export async function apiBlob(path, filename) {
  const token = getToken();
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, { headers });
  if (!res.ok) {
    const err = new Error('Export failed.');
    err.status = res.status;
    throw err;
  }
  const blob = await res.blob();
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}