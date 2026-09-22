/**
 * Notification service.
 *
 * v1 policy from the brief:
 *  - The HR dashboard is the ping. We do NOT email HR for every normal arrival.
 *  - Exceptions (unknown devices, data gaps) and late arrivals are pushed to
 *    connected HR sessions over the socket.
 *  - Per-HR-user email/push opt-in is Phase 2 (config flag only here).
 */
export class NotificationService {
  constructor() {
    this.socketEmitter = null; // set after socket module boots
  }

  _emit(event, payload) {
    if (this.socketEmitter) this.socketEmitter(event, payload);
  }

  /** A normal (on-time) arrival — dashboard toast only, per brief. */
  arrival({ employee, department, arrivedAt, lateMinutes, isLate }) {
    this._emit('attendance:updated', {
      kind: 'arrival',
      employee: { id: employee.id, name: employee.name },
      department: department ? { id: department.id, name: department.name } : null,
      arrivedAt,
      lateMinutes,
      isLate,
    });
  }

  /** Check-out event for the live feed. */
  departure({ employee, department, departureAt }) {
    this._emit('attendance:updated', {
      kind: 'departure',
      employee: { id: employee.id, name: employee.name },
      department: department ? { id: department.id, name: department.name } : null,
      departureAt,
    });
  }

  /** An exception the HR queue must see. */
  exception({ employee, department, reason, note }) {
    this._emit('attendance:exception', {
      employee: employee
        ? { id: employee.id, name: employee.name }
        : { id: null, name: 'Unknown device' },
      department: department ? { id: department.id, name: department.name } : null,
      reason,
      note,
    });
  }

  /** Generic totals refresh (counters on the dashboard, department bars). */
  totals(totals) {
    this._emit('attendance:totals', totals);
  }

  /** Live running net-hours tick for on-site employees. */
  live(liveEntries) {
    this._emit('live:now', liveEntries);
  }

  /** Network status changed (outage started / recovered). */
  network(status) {
    this._emit('network:status', status);
  }

  /** Monthly register compiled / closed / reopened. */
  monthly(period) {
    this._emit('monthly:updated', period);
  }
}

export const notificationService = new NotificationService();