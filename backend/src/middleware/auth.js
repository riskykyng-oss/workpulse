import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';

/** Attach the verified user to req.user, or 401. */
export function requireAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return next(Object.assign(new Error('Authentication required'), { status: 401 }));
  }
  try {
    req.user = jwt.verify(token, env.jwtSecret);
    return next();
  } catch {
    return next(Object.assign(new Error('Session expired or invalid'), { status: 401 }));
  }
}

/** Restrict a route to a set of roles. */
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(Object.assign(new Error('Authentication required'), { status: 401 }));
    if (!roles.includes(req.user.role)) {
      return next(Object.assign(new Error('You do not have permission to do that.'), { status: 403 }));
    }
    return next();
  };
}

/**
 * Manager scoping helper for list queries.
 * @returns {{ departmentId?: string } | null} the where-fragment to apply
 */
export function managerScope(req) {
  if (req.user?.role === 'MANAGER') return { departmentId: req.user.departmentId };
  return null;
}

/**
 * Restrict an employee-targeted route (e.g. /attendance/employee/:employeeId)
 * to the employee themself or to staff roles. Managers are additionally
 * confined to their own department.
 */
export function requireEmployeeAccess(paramName, ...roles) {
  return async (req, _res, next) => {
    try {
      if (!req.user) return next(Object.assign(new Error('Authentication required'), { status: 401 }));
      const targetId = req.params[paramName];

      // Non-staff roles (EMPLOYEE) may only read their own record.
      if (!roles.includes(req.user.role)) {
        const isSelf = req.user.employeeId != null && String(req.user.employeeId) === String(targetId);
        if (isSelf) return next();
        return next(Object.assign(new Error('You do not have permission to do that.'), { status: 403 }));
      }

      // Managers can only reach employees within their department.
      if (req.user.role === 'MANAGER' && req.user.departmentId) {
        const employee = await prisma.employee.findUnique({ where: { id: targetId }, select: { departmentId: true } });
        if (!employee) return next(Object.assign(new Error('Employee not found.'), { status: 404 }));
        if (employee.departmentId !== req.user.departmentId) {
          return next(Object.assign(new Error('You do not have permission to do that.'), { status: 403 }));
        }
      }
      return next();
    } catch (err) {
      next(err);
    }
  };
}