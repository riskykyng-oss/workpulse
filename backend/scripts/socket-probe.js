/* Socket latency probe: simulate an arrival and measure how fast the socket
 * event reaches a connected client (~2s acceptance window). */
const { io } = require('socket.io-client');

const BASE = 'http://127.0.0.1:4000';

async function login(email, password) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(`login ${r.status}`);
  return r.json();
}

async function run() {
  const { token } = await login('admin@harcourt.co.zw', 'workpulse');
  const hdrs = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const liveRes = await fetch(`${BASE}/api/attendance/live`, { headers: hdrs });
  const live = (await liveRes.json()).records;

  const emp = live.find((r) => r.status === 'ABSENT' && r.employee.devices.length > 0);
  if (!emp) throw new Error('no absent employee with a device');
  const employeeId = emp.employee.id;

  const socket = io(BASE, { auth: { token }, transports: ['websocket'] });
  let got = [];
  socket.on('attendance:updated', (p) => got.push({ t: Date.now(), kind: p.kind || 'arrival', status: p.isLate ? 'LATE' : 'OK' }));
  socket.on('attendance:totals', (p) => got.push({ t: Date.now(), kind: 'totals', present: p.present }));

  await new Promise((res, rej) => {
    socket.on('connect', res);
    socket.on('connect_error', (e) => rej(new Error(e.message)));
    setTimeout(() => rej(new Error('connect timeout')), 8000);
  });

  const start = Date.now();
  const simRes = await fetch(`${BASE}/api/simulate/arrival`, {
    method: 'POST', headers: hdrs,
    body: JSON.stringify({ employeeId, at: '08:45' }),
  });
  const sim = await simRes.json();
  const httpMs = Date.now() - start;
  console.log('simulate HTTP status:', sim.result && sim.result.status, 'httpLatency:', httpMs);

  await new Promise((res) => setTimeout(res, 400));
  socket.disconnect();
  console.log('socket events received:', JSON.stringify(got));
  if (!got.length) {
    console.log('RESULT: FAIL - no socket event within 400ms');
    process.exitCode = 1;
  } else {
    console.log('RESULT: socket-ahead-of-http =', got[0].t - (start + httpMs), 'ms after HTTP response');
  }
}

run().catch((e) => { console.error('PROBE ERROR:', e.message); process.exitCode = 1; });