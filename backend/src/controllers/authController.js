import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { audit } from '../services/auditService.js';

const loginSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});

export async function login(req, res, next) {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({
      where: { email: String(email).toLowerCase().trim() },
      include: { employee: { include: { department: true } }, organization: { include: { rules: true } } },
    });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }
    const token = jwt.sign(
      {
        id: user.id,
        name: user.employee?.name || user.email,
        role: user.role,
        departmentId: user.employee?.departmentId || null,
        employeeId: user.employeeId || null,
        email: user.email,
      },
      env.jwtSecret,
      { expiresIn: env.jwtExpiresIn },
    );
    await audit({
      action: 'auth.login',
      actorId: user.id,
      actorName: user.employee?.name || user.email,
    });
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    next(err);
  }
}

export async function me(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { employee: { include: { department: true } }, organization: { include: { rules: true } } },
    });
    res.json({ user: publicUser(user) });
  } catch (err) {
    next(err);
  }
}

export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    settings: user.settings,
    employee: user.employee
      ? {
          id: user.employee.id,
          name: user.employee.name,
          firstName: user.employee.firstName,
          lastName: user.employee.lastName,
          position: user.employee.position,
          employeeNo: user.employee.employeeNo,
          employmentType: user.employee.employmentType,
          department: user.employee.department ? { id: user.employee.department.id, name: user.employee.department.name } : null,
        }
      : null,
    organization: user.organization
      ? {
          id: user.organization.id,
          name: user.organization.name,
          timezone: user.organization.timezone,
          workWeek: user.organization.workWeek,
        }
      : null,
  };
}