import { describe, it, expect } from 'vitest';
import { prisma } from '../config/prisma.js';
import { attendanceService } from './attendanceService.js';

const on = process.env.WORKPULSE_TEST === '1';

async function actor() {
  const user = await prisma.user.findFirst({ where: { role: { not: 'EMPLOYEE' } } });
  return { id: user.id, name: user.name || user.email };
}

async function recordIn(monthPrefix) {
  return prisma.attendanceRecord.findFirst({
    where: { date: { gte: new Date(`${monthPrefix}-01T00:00:00.000Z`), lt: new Date(`${monthPrefix}-31T00:00:00.000Z`) } },
  });
}

describe.skipIf(!on)('attendance corrections (integration)', () => {
  it('applies a correction with a reason, writes the corpus trail and clears needsReview', async () => {
    const record = await recordIn('2026-09');
    expect(record, 'expected a seeded 2026-09 record').toBeTruthy();

    const res = await attendanceService.correct({
      recordId: record.id,
      changes: { status: 'ABSENT' },
      reason: 'Vitest correction flow check',
      actor: await actor(),
    });

    expect(res.status).toBe('ABSENT');
    expect(res.source).toBe('manual');
    expect(res.needsReview).toBe(false);

    const corr = await prisma.attendanceCorrection.findFirst({
      where: { attendanceRecordId: record.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(corr).toBeTruthy();
    expect(corr.reason).toBe('Vitest correction flow check');
    expect(corr.newValue.status).toBe('ABSENT');

    const log = await prisma.auditLog.findFirst({
      where: { action: 'attendance.correct', targetId: record.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(log).toBeTruthy();
    expect(log.reason).toBe('Vitest correction flow check');
  });

  it('rejects a blank reason with 400', async () => {
    const record = await recordIn('2026-09');
    await expect(
      attendanceService.correct({ recordId: record.id, changes: { status: 'PRESENT' }, reason: '', actor: await actor() })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses to correct a CLOSED period with 409', async () => {
    const record = await recordIn('2026-08');
    expect(record, 'expected a seeded 2026-08 record').toBeTruthy();

    const period = await prisma.monthlyPeriod.findUnique({ where: { month: '2026-08' } });
    expect(period.status).toBe('CLOSED');

    await expect(
      attendanceService.correct({ recordId: record.id, changes: { status: 'PRESENT' }, reason: 'should not pass', actor: await actor() })
    ).rejects.toMatchObject({ status: 409 });
  });
});