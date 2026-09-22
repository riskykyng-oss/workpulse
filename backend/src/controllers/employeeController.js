import { prisma } from '../config/prisma.js';
import { managerScope } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { attendanceService } from '../services/attendanceService.js';
import { demoMonthYmd } from '../utils/time.js';

export async function list(req, res, next) {
  try {
    const scope = managerScope(req);
    const where = {};
    if (scope) where.departmentId = scope.departmentId;
    if (req.query.departmentId) where.departmentId = String(req.query.departmentId);
    if (req.query.status) where.active = req.query.status === 'active';
    const employees = await prisma.employee.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        department: true,
        devices: { orderBy: { isPrimary: 'desc' } },
        _count: { select: { devices: true } },
      },
    });
    const q = req.query.q ? String(req.query.q).toLowerCase() : null;
    const rows = employees
      .filter((e) => !q || e.name.toLowerCase().includes(q) || e.employeeNo.toLowerCase().includes(q) || (e.email || '').toLowerCase().includes(q))
      .map((e) => ({
        id: e.id,
        employeeNo: e.employeeNo,
        name: e.name,
        firstName: e.firstName,
        lastName: e.lastName,
        email: e.email,
        position: e.position,
        employmentType: e.employmentType,
        active: e.active,
        department: { id: e.department.id, name: e.department.name },
        deviceCount: e._count.devices,
        primaryDevice: e.devices.find((d) => d.isPrimary) || e.devices[0] || null,
      }));
    res.json({ employees: rows, count: rows.length });
  } catch (err) {
    next(err);
  }
}

export async function detail(req, res, next) {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: req.params.id },
      include: {
        department: true,
        devices: { orderBy: { isPrimary: 'desc' } },
        user: { select: { id: true, email: true, role: true } },
      },
    });
    if (!employee) return res.status(404).json({ error: 'Employee not found.' });

    const scope = managerScope(req);
    if (scope && employee.department.id !== scope.departmentId) {
      return res.status(403).json({ error: 'You do not have permission to do that.' });
    }

    const recent = await attendanceService.getByEmployee(employee.id, 60);
    const activity = await prisma.auditLog.findMany({
      where: { OR: [{ targetId: employee.id }, { targetId: { in: recent.map((r) => r.id) } }] },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    const month = demoMonthYmd();
    const thisMonth = recent.filter((r) => r.date.toISOString().slice(0, 7) === month);
    const summary = {
      daysPresent: thisMonth.filter((r) => r.status === 'PRESENT' || r.status === 'LATE').length,
      daysLate: thisMonth.filter((r) => r.status === 'LATE').length,
      daysAbsent: thisMonth.filter((r) => r.status === 'ABSENT').length,
      daysLeave: thisMonth.filter((r) => r.status === 'ON_LEAVE').length,
      netMinutes: thisMonth.reduce((a, r) => a + r.netMinutes, 0),
    };

    res.json({
      employee: {
        id: employee.id,
        employeeNo: employee.employeeNo,
        name: employee.name,
        firstName: employee.firstName,
        lastName: employee.lastName,
        email: employee.email,
        position: employee.position,
        employmentType: employee.employmentType,
        startDate: employee.startDate,
        active: employee.active,
        department: { id: employee.department.id, name: employee.department.name },
        devices: employee.devices.map((d) => ({
          id: d.id,
          name: d.name,
          type: d.type,
          os: d.os,
          identifier: d.identifier,
          identityStrategy: d.identityStrategy,
          isPrimary: d.isPrimary,
          status: d.status,
          lastSeenAt: d.lastSeenAt,
          registeredAt: d.registeredAt,
        })),
        user: employee.user,
      },
      summary,
      recent,
      activity: activity.map((a) => ({
        id: a.id,
        action: a.action,
        at: a.createdAt,
        actorName: a.actorName,
        reason: a.reason,
      })),
    });
  } catch (err) {
    next(err);
  }
}

export async function create(req, res, next) {
  try {
    const {
      firstName, lastName, email, position, departmentId, employmentType = 'FULL_TIME', employeeNo, startDate,
    } = req.body;
    const name = `${firstName} ${lastName}`.trim();
    const employee = await prisma.employee.create({
      data: {
        employeeNo: employeeNo || `WP-${String(Math.floor(1000 + Math.random() * 9000))}`,
        name,
        firstName,
        lastName,
        email: email || null,
        position,
        departmentId,
        employmentType,
        active: true,
        startDate: startDate ? new Date(startDate) : new Date(),
      },
    });
    await audit({
      action: 'employee.create',
      actorId: req.user.id,
      actorName: req.user.name,
      targetType: 'employee',
      targetId: employee.id,
      reason: 'Added new employee',
      detail: { name, position, departmentId },
    });
    res.status(201).json({ employee });
  } catch (err) {
    next(err);
  }
}

export async function updateActive(req, res, next) {
  try {
    const { active } = req.body;
    const employee = await prisma.employee.update({
      where: { id: req.params.id },
      data: { active: Boolean(active) },
    });
    await audit({
      action: 'employee.archive',
      actorId: req.user.id,
      actorName: req.user.name,
      targetType: 'employee',
      targetId: employee.id,
      reason: 'Changed employee status',
    });
    res.json({ employee });
  } catch (err) {
    next(err);
  }
}