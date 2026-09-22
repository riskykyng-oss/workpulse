import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { notificationService } from '../services/notificationService.js';

/**
 * Wire Socket.IO to the HTTP server and connect the notification service.
 *
 * Event contract (all server → client, JSON):
 *  - attendance:updated   { kind: 'arrival'|'departure', employee, department, arrivedAt|departureAt, isLate, lateMinutes }
 *  - attendance:exception { employee, department, reason, note }
 *  - attendance:totals    { headcount, present, late, absent, onLeave, notExpected, needsReview, byDepartment, at }
 *  - live:now             [{ employeeId, netMinutes }]
 *  - network:status       { status, lastSyncAt, connectedDevices }
 *  - monthly:updated      period summary
 */
export function setupSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: env.frontendOrigin, credentials: true },
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('unauthorized'));
      const payload = jwt.verify(token, env.jwtSecret);
      socket.user = {
        id: payload.id,
        name: payload.name,
        role: payload.role,
        departmentId: payload.departmentId || null,
      };
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.join('hr');
  });

  notificationService.socketEmitter = (event, payload) => {
    io.to('hr').emit(event, payload);
  };

  return io;
}

/**
 * The network status published to the top bar. V1 reports the mock feed; a
 * real adapter would surface router/controller health here.
 */
export async function networkStatus() {
  const { prisma } = await import('../config/prisma.js');
  const [networks, eventsToday] = await Promise.all([
    prisma.network.findMany({ include: { location: true } }),
    prisma.networkEvent.count({ where: { createdAt: { gte: new Date(Date.now() - 60000) } } }),
  ]);
  return {
    feed: 'mock',
    status: networks.length ? 'online' : 'offline',
    network: networks[0]?.name || 'Head Office',
    location: networks[0]?.location?.name || 'Harcourt Group',
    lastSyncAt: new Date().toISOString(),
    connectedDevices: eventsToday,
    note: 'Detection adapter: mock (simulated network)',
  };
}