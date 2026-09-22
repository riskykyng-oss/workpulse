import cron from 'node-cron';
import { monthlyService } from '../services/monthlyService.js';
import { notificationService } from '../services/notificationService.js';
import { prisma } from '../config/prisma.js';
import { presenceService } from '../services/presenceService.js';
import { orgYmd, daysInMonth, orgToday } from '../utils/time.js';

const ORG_TZ = 'Africa/Harare';

/**
 * Month-end auto-compile. Runs every evening at 23:55; on the last day of the
 * month it compiles the period and moves it to Ready for review — exactly the
 * "no manual work" promise.
 */
export function startMonthlyScheduler() {
  return cron.schedule('55 23 * * *', async () => {
    try {
      const today = orgToday();
      const month = orgYmd(today, ORG_TZ).slice(0, 7);
      const todayDay = Number(orgYmd(today, ORG_TZ).slice(8, 10));
      if (todayDay !== daysInMonth(month)) return;

      const org = await prisma.organization.findFirst({ include: { rules: true } });
      const rules = org?.rules;
      if (rules && rules.monthEndDayMode === 'FIXED' && todayDay !== rules.monthEndFixedDay) return;

      const period = await prisma.monthlyPeriod.findUnique({ where: { month } });
      if (period && period.status !== 'IN_PROGRESS') return;

      const compiled = await monthlyService.compile(month, 'System');
      notificationService.monthly({ month, status: compiled.status, compiled: true });
    } catch (err) {
      console.error('monthly compile job failed:', err);
    }
  });
}

/** Publish live net-hours every minute for on-site employees. */
export function startLiveTicker() {
  return setInterval(() => {
    presenceService.liveTick().catch(() => {});
  }, 60000);
}

/** Keep the network pill honest. */
export function startNetworkPing() {
  return setInterval(async () => {
    try {
      const { networkStatus } = await import('../socket/attendanceSocket.js');
      const ns = await networkStatus();
      notificationService.network(ns);
    } catch {
      /* non-critical */
    }
  }, 30000);
}