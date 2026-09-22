import { prisma } from '../config/prisma.js';
import { audit } from '../services/auditService.js';
import { managerScope } from '../middleware/auth.js';
import { randomUUID } from 'node:crypto';

export async function list(req, res, next) {
  try {
    const scope = managerScope(req);
    const devices = await prisma.device.findMany({
      orderBy: [{ isPrimary: 'desc' }, { registeredAt: 'desc' }],
      include: { employee: { include: { department: true } } },
      where: scope ? { employee: { departmentId: scope.departmentId } } : undefined,
    });
    const noDevice = await prisma.employee.count({ where: scope ? { departmentId: scope.departmentId, devices: { none: {} } } : { devices: { none: {} } } });
    res.json({
      devices: devices.map((d) => ({
        id: d.id,
        name: d.name,
        type: d.type,
        os: d.os,
        identifier: d.identifier,
        identityStrategy: d.identityStrategy,
        status: d.status,
        isPrimary: d.isPrimary,
        registeredAt: d.registeredAt,
        lastSeenAt: d.lastSeenAt,
        employee: { id: d.employee.id, name: d.employee.name, employeeNo: d.employee.employeeNo, department: d.employee.department.name },
      })),
      noDeviceCount: noDevice,
    });
  } catch (err) {
    next(err);
  }
}

export async function register(req, res, next) {
  try {
    const { employeeId, name, type = 'PHONE', os = 'iOS', identifier, identityStrategy = 'COMPANION_UUID' } = req.body;
    const device = await prisma.device.create({
      data: {
        employeeId,
        name: name || 'Registered device',
        type,
        os,
        identifier: identifier || `cmp-${randomUUID().slice(0, 12)}`,
        identityStrategy,
        status: 'ACTIVE',
      },
    });
    await audit({
      action: 'device.register',
      actorId: req.user.id,
      actorName: req.user.name,
      targetType: 'device',
      targetId: device.id,
      reason: 'Registered device',
      detail: { employeeId, type, os, identityStrategy },
    });
    res.status(201).json({ device });
  } catch (err) {
    next(err);
  }
}

export async function setPrimary(req, res, next) {
  try {
    const device = await prisma.device.findUnique({ where: { id: req.params.id } });
    if (!device) return res.status(404).json({ error: 'Device not found.' });
    await prisma.$transaction([
      prisma.device.updateMany({ where: { employeeId: device.employeeId }, data: { isPrimary: false } }),
      prisma.device.update({ where: { id: device.id }, data: { isPrimary: true } }),
    ]);
    await audit({
      action: 'device.primary',
      actorId: req.user.id,
      actorName: req.user.name,
      targetType: 'device',
      targetId: device.id,
      reason: 'Marked as primary device',
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

export async function deactivate(req, res, next) {
  try {
    const device = await prisma.device.update({
      where: { id: req.params.id },
      data: { status: 'INACTIVE' },
    });
    await audit({
      action: 'device.deactivate',
      actorId: req.user.id,
      actorName: req.user.name,
      targetType: 'device',
      targetId: device.id,
      reason: 'Deactivated device',
    });
    res.json({ device });
  } catch (err) {
    next(err);
  }
}