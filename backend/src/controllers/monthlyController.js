import { monthlyService, prevMonth } from '../services/monthlyService.js';
import { audit } from '../services/auditService.js';
import { notificationService } from '../services/notificationService.js';

export async function list(req, res, next) {
  try {
    const periods = await monthlyService.list();
    res.json({ periods });
  } catch (err) {
    next(err);
  }
}

export async function get(req, res, next) {
  try {
    const data = await monthlyService.get(req.params.month);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function compile(req, res, next) {
  try {
    const data = await monthlyService.compile(req.params.month, req.user.name, req.user.id);
    notificationService.monthly({ month: data.month, status: data.status });
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function close(req, res, next) {
  try {
    const period = await monthlyService.close(req.params.month, req.user, req.body.reason);
    notificationService.monthly({ month: period.month, status: period.status });
    res.json(period);
  } catch (err) {
    next(err);
  }
}

export async function reopen(req, res, next) {
  try {
    const period = await monthlyService.reopen(req.params.month, req.user, req.body.reason);
    notificationService.monthly({ month: period.month, status: period.status });
    res.json(period);
  } catch (err) {
    next(err);
  }
}

export async function exportMonthly(req, res, next) {
  try {
    const format = String(req.query.format || 'csv');
    const month = req.params.month;
    await audit({
      action: 'monthly.export',
      actorId: req.user.id,
      actorName: req.user.name,
      targetType: 'monthly_period',
      targetId: month,
      reason: `Exported ${month} as ${format.toUpperCase()}`,
    });
    if (format === 'csv') {
      const csv = await monthlyService.exportCsv(month);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="attendance-${month}.csv"`);
      return res.send(csv);
    }
    if (format === 'xlsx') {
      const buf = await monthlyService.exportXlsx(month);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="attendance-${month}.xlsx"`);
      return res.send(Buffer.from(buf));
    }
    if (format === 'pdf') {
      const buf = await monthlyService.exportPdf(month);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="attendance-${month}.pdf"`);
      return res.send(buf);
    }
    return res.status(400).json({ error: 'Unknown export format.' });
  } catch (err) {
    next(err);
  }
}

void prevMonth;