import { z } from 'zod';
import { mockAdapter } from '../detection/MockDetectionAdapter.js';
import { presenceService } from '../services/presenceService.js';
import { notificationService } from '../services/notificationService.js';
import { orgToday } from '../utils/time.js';
import { audit } from '../services/auditService.js';

const NETWORK = 'Head Office';

/**
 * Demo controls for the Mock detection adapter. Each one pushes a real
 * detection through the normal detection → confirmation → arrival → ping
 * pipeline. These routes are what make the product demoable without hardware,
 * and they double as the acceptance-test drivers.
 */

const arrivalSchema = z.object({
  employeeId: z.string().min(1, 'Choose an employee'),
  at: z.string().optional(), // 'HH:MM' on today's org date
  networkName: z.string().optional(),
});

export async function simulateArrival(req, res, next) {
  try {
    const { employeeId, at, networkName } = arrivalSchema.parse(req.body);
    const device = await findPrimaryDevice(employeeId);
    if (!device) {
      return res.status(400).json({ error: 'This employee has no registered device.' });
    }
    const ts = at ? toOrgInstant(at) : new Date();
    const pushed = await mockAdapter.simulate({
      rawDeviceId: device.identifier,
      networkName: networkName || NETWORK,
      eventType: 'CONNECT',
      timestamp: ts,
      adapterSource: 'mock:demo',
    });
    if (!pushed) return res.status(503).json({ error: 'Feed is down (outage simulated).' });
    const result = await presenceService.recomputeEmployeeDay(employeeId, ts);
    await audit({
      action: 'simulate.arrival',
      actorId: req.user.id,
      actorName: req.user.name,
      targetType: 'employee',
      targetId: employeeId,
      reason: 'Demo — simulated device arrival',
      detail: { at: ts.toISOString() },
    });
    res.json({ ok: true, at: ts.toISOString(), result: { status: result.status, recordId: result.recordId } });
  } catch (err) {
    next(err);
  }
}

export async function simulateDeparture(req, res, next) {
  try {
    const { employeeId, at, networkName } = arrivalSchema.parse(req.body);
    const device = await findPrimaryDevice(employeeId);
    if (!device) return res.status(400).json({ error: 'This employee has no registered device.' });
    const ts = at ? toOrgInstant(at) : new Date();
    await mockAdapter.simulate({
      rawDeviceId: device.identifier,
      networkName: networkName || NETWORK,
      eventType: 'DISCONNECT',
      timestamp: ts,
      adapterSource: 'mock:demo',
    });
    await presenceService.recomputeEmployeeDay(employeeId, ts);
    await audit({
      action: 'simulate.departure',
      actorId: req.user.id,
      actorName: req.user.name,
      targetType: 'employee',
      targetId: employeeId,
      reason: 'Demo — simulated device departure',
    });
    res.json({ ok: true, at: ts.toISOString() });
  } catch (err) {
    next(err);
  }
}

/** Two-step lunch demo: leave for lunch then return (two detections). */
export async function simulateLunch(req, res, next) {
  try {
    const { employeeId, offAt, onAt } = lunchSchema.parse(req.body);
    const device = await findPrimaryDevice(employeeId);
    if (!device) return res.status(400).json({ error: 'This employee has no registered device.' });

    const offTs = toOrgInstant(offAt);
    const onTs = toOrgInstant(onAt);

    await mockAdapter.simulate({ rawDeviceId: device.identifier, networkName: NETWORK, eventType: 'DISCONNECT', timestamp: offTs, adapterSource: 'mock:demo' });
    await mockAdapter.simulate({ rawDeviceId: device.identifier, networkName: NETWORK, eventType: 'CONNECT', timestamp: onTs, adapterSource: 'mock:demo' });
    const result = await presenceService.recomputeEmployeeDay(employeeId, onTs);
    await audit({
      action: 'simulate.lunch',
      actorId: req.user.id,
      actorName: req.user.name,
      targetType: 'employee',
      targetId: employeeId,
      reason: 'Demo — simulated lunch window',
      detail: { offAt: offTs.toISOString(), onAt: onTs.toISOString() },
    });
    res.json({ ok: true, offAt: offTs.toISOString(), onAt: onTs.toISOString(), status: result.status });
  } catch (err) {
    next(err);
  }
}

const unknownSchema = z.object({
  at: z.string().optional(),
  networkName: z.string().optional(),
});

export async function simulateUnknownDevice(req, res, next) {
  try {
    const { at, networkName } = unknownSchema.parse(req.body);
    const ts = at ? toOrgInstant(at) : new Date();
    await mockAdapter.simulate({
      rawDeviceId: `unknown-${Math.random().toString(36).slice(2, 8)}`,
      networkName: networkName || NETWORK,
      eventType: 'CONNECT',
      timestamp: ts,
      adapterSource: 'mock:demo',
    });
    await audit({
      action: 'simulate.unknown_device',
      actorId: req.user.id,
      actorName: req.user.name,
      reason: 'Demo — simulated unregistered device',
    });
    res.json({ ok: true, at: ts.toISOString() });
  } catch (err) {
    next(err);
  }
}

const outageSchema = z.object({ on: z.boolean() });

export async function simulateOutage(req, res, next) {
  try {
    const { on } = outageSchema.parse(req.body);
    mockAdapter.outage = on;
    await presenceService.setOutage(on, req.user.name);
    const { networkStatus } = await import('../socket/attendanceSocket.js');
    const ns = await networkStatus();
    notificationService.network({ ...ns, status: on ? 'offline' : 'online' });
    await audit({
      action: on ? 'simulate.outage_on' : 'simulate.outage_off',
      actorId: req.user.id,
      actorName: req.user.name,
      reason: `Demo — network feed ${on ? 'outage started' : 'recovered'}`,
    });
    res.json({ ok: true, outage: on });
  } catch (err) {
    next(err);
  }
}

export const status = async (_req, res) => {
  res.json({ adapter: 'mock', outage: mockAdapter.outage });
};

async function findPrimaryDevice(employeeId) {
  const devices = await import('../config/prisma.js').then((m) => m.prisma.device.findMany({
    where: { employeeId, status: 'ACTIVE' },
    orderBy: { isPrimary: 'desc' },
    take: 1,
  }));
  return devices[0] || null;
}

function toOrgInstant(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const day = orgToday();
  return new Date(day.getTime() + (h * 60 + m) * 60000);
}

const lunchSchema = z.object({
  employeeId: z.string().min(1),
  offAt: z.string(),
  onAt: z.string(),
});