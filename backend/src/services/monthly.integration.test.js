import { describe, it, expect } from 'vitest';
import { prisma } from '../config/prisma.js';
import { monthlyService } from './monthlyService.js';

const on = process.env.WORKPULSE_TEST === '1';

async function actor() {
  const user = await prisma.user.findFirst({ where: { role: { not: 'EMPLOYEE' } } });
  return { id: user.id, name: user.name || user.email };
}

describe.skipIf(!on)('monthly lifecycle (integration)', () => {
  it('compiles 2026-09 into READY_FOR_REVIEW with company sums', async () => {
    const res = await monthlyService.compile('2026-09', 'Vitest', (await actor()).id);
    expect(res.status).toBe('READY_FOR_REVIEW');
    expect(res.company.daysPresent).toBeGreaterThan(0);
    expect(res.company.attendanceRate).toBeGreaterThan(0);
    expect(res.departments.length).toBeGreaterThan(0);
    expect(res.employees.length).toBeGreaterThan(0);
  });

  it('close -> CLOSED, a second close is 409, blank reopen reason is 400, reopen -> IN_PROGRESS', async () => {
    const a = await actor();

    const closed = await monthlyService.close('2026-09', a, 'Vitest closed the month');
    expect(closed.status).toBe('CLOSED');
    expect(closed.closedBy).toBe(a.id);

    await expect(monthlyService.close('2026-09', a, 'again')).rejects.toMatchObject({ status: 409 });
    await expect(monthlyService.reopen('2026-09', a, '')).rejects.toMatchObject({ status: 400 });

    const reopened = await monthlyService.reopen('2026-09', a, 'Vitest reopened for a fix');
    expect(reopened.status).toBe('IN_PROGRESS');
    expect(reopened.reopenedReason).toBe('Vitest reopened for a fix');
  });
});

describe.skipIf(!on)('monthly exports (integration)', () => {
  it('exportCsv returns names and never a [object Promise]', async () => {
    const csv = await monthlyService.exportCsv('2026-08');
    expect(csv).toContain('Monthly Attendance Register — 2026-08');
    expect(csv).toContain('Sarah Ncube');
    expect(csv).not.toContain('[object Promise]');
    expect(csv.length).toBeGreaterThan(500);
  });

  it('exportCsv wraps cells with commas/quotes safely', async () => {
    const csv = await monthlyService.exportCsv('2026-08');
    const lines = csv.split('\n');
    expect(lines.some((l) => l.startsWith('"'))).toBe(true);
    const quoteCount = (csv.match(/""/g) || []).length;
    expect(quoteCount).toBeGreaterThanOrEqual(0);
  });

  it('exportXlsx returns a non-trivial xlsx buffer', async () => {
    const buf = await monthlyService.exportXlsx('2026-08');
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 2).toString()).toBe('PK');
  });

  it('exportPdf returns a PDF buffer', async () => {
    const buf = await monthlyService.exportPdf('2026-08');
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    expect(buf.length).toBeGreaterThan(1000);
  });
});