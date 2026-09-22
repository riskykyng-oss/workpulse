import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { requireAuth, requireRole, managerScope, requireEmployeeAccess } from './auth.js';

vi.mock('../config/prisma.js', () => ({
  prisma: { employee: { findUnique: vi.fn() } },
}));
const { prisma } = await import('../config/prisma.js');

function nextCapturer() {
  const calls = { errors: [], nextCount: 0 };
  const next = (err) => {
    if (err) calls.errors.push(err);
    else calls.nextCount += 1;
  };
  return { calls, next };
}

function tokenFor(user) {
  return jwt.sign(user, env.jwtSecret);
}

function authed(user) {
  return { headers: { authorization: `Bearer ${tokenFor(user)}` } };
}

describe('requireAuth', () => {
  it('401 without a Bearer token', () => {
    const { calls, next } = nextCapturer();
    requireAuth({ headers: {} }, {}, next);
    expect(calls.errors[0].status).toBe(401);
  });

  it('401 on a malformed header', () => {
    const { calls, next } = nextCapturer();
    requireAuth({ headers: { authorization: 'nope' } }, {}, next);
    expect(calls.errors[0].status).toBe(401);
  });

  it('401 on an invalid token', () => {
    const { calls, next } = nextCapturer();
    requireAuth({ headers: { authorization: 'Bearer not.a.jwt' } }, {}, next);
    expect(calls.errors[0].status).toBe(401);
  });

  it('attaches the verified user for a valid token', () => {
    const { calls, next } = nextCapturer();
    const req = authed({ id: 'u1', role: 'HR_ADMIN' });
    requireAuth(req, {}, next);
    expect(calls.nextCount).toBe(1);
    expect(req.user.role).toBe('HR_ADMIN');
  });
});

describe('requireRole', () => {
  it('401 when nobody is attached', () => {
    const { calls, next } = nextCapturer();
    requireRole('HR_ADMIN')({ user: null }, {}, next);
    expect(calls.errors[0].status).toBe(401);
  });

  it('403 for a role outside the allowlist', () => {
    const { calls, next } = nextCapturer();
    requireRole('HR_ADMIN')({ user: { role: 'MANAGER' } }, {}, next);
    expect(calls.errors[0].status).toBe(403);
  });

  it('passes for an allowed role', () => {
    const { calls, next } = nextCapturer();
    requireRole('HR_ADMIN', 'SUPER_ADMIN')({ user: { role: 'HR_ADMIN' } }, {}, next);
    expect(calls.nextCount).toBe(1);
  });
});

describe('managerScope', () => {
  it('scopes managers to their department', () => {
    expect(managerScope({ user: { role: 'MANAGER', departmentId: 'dept-9' } })).toEqual({ departmentId: 'dept-9' });
  });

  it('is null for staff roles', () => {
    expect(managerScope({ user: { role: 'HR_ADMIN' } })).toBeNull();
    expect(managerScope({ user: { role: 'SUPER_ADMIN' } })).toBeNull();
  });
});

describe('requireEmployeeAccess', () => {
  beforeEach(() => {
    vi.mocked(prisma.employee.findUnique).mockReset();
  });

  it('lets an EMPLOYEE read their own record', async () => {
    const { calls, next } = nextCapturer();
    const mw = requireEmployeeAccess('employeeId', 'SUPER_ADMIN', 'HR_ADMIN', 'MANAGER', 'VIEWER');
    await mw({ params: { employeeId: 'emp-1' }, user: { role: 'EMPLOYEE', employeeId: 'emp-1' } }, {}, next);
    expect(calls.nextCount).toBe(1);
  });

  it('blocks an EMPLOYEE from another employee record (IDOR guard)', async () => {
    const { calls, next } = nextCapturer();
    const mw = requireEmployeeAccess('employeeId', 'SUPER_ADMIN', 'HR_ADMIN', 'MANAGER', 'VIEWER');
    await mw({ params: { employeeId: 'emp-2' }, user: { role: 'EMPLOYEE', employeeId: 'emp-1' } }, {}, next);
    expect(calls.errors[0].status).toBe(403);
  });

  it('403 to a manager whose department differs', async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ departmentId: 'ops' });
    const { calls, next } = nextCapturer();
    const mw = requireEmployeeAccess('employeeId', 'SUPER_ADMIN', 'HR_ADMIN', 'MANAGER', 'VIEWER');
    await mw({ params: { employeeId: 'emp-2' }, user: { role: 'MANAGER', departmentId: 'fin' } }, {}, next);
    expect(calls.errors[0].status).toBe(403);
  });

  it('404 from a manager when the target employee does not exist', async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(null);
    const { calls, next } = nextCapturer();
    const mw = requireEmployeeAccess('employeeId', 'SUPER_ADMIN', 'HR_ADMIN', 'MANAGER', 'VIEWER');
    await mw({ params: { employeeId: 'nope' }, user: { role: 'MANAGER', departmentId: 'fin' } }, {}, next);
    expect(calls.errors[0].status).toBe(404);
  });

  it('passes a manager whose department matches', async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ departmentId: 'fin' });
    const { calls, next } = nextCapturer();
    const mw = requireEmployeeAccess('employeeId', 'SUPER_ADMIN', 'HR_ADMIN', 'MANAGER', 'VIEWER');
    await mw({ params: { employeeId: 'emp-2' }, user: { role: 'MANAGER', departmentId: 'fin' } }, {}, next);
    expect(calls.nextCount).toBe(1);
  });

  it('passes staff roles regardless of their own department', async () => {
    const { calls, next } = nextCapturer();
    const mw = requireEmployeeAccess('employeeId', 'SUPER_ADMIN', 'HR_ADMIN', 'MANAGER', 'VIEWER');
    await mw({ params: { employeeId: 'emp-2' }, user: { role: 'VIEWER', employeeId: 'emp-9' } }, {}, next);
    expect(calls.nextCount).toBe(1);
  });
});