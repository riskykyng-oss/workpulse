import { Router } from 'express';
import * as c from '../controllers/attendanceController.js';
import { requireAuth, requireRole, requireEmployeeAccess } from '../middleware/auth.js';

const router = Router();

router.get('/live', requireAuth, requireRole('SUPER_ADMIN', 'HR_ADMIN', 'MANAGER', 'VIEWER'), c.getLive);
router.get('/history', requireAuth, requireRole('SUPER_ADMIN', 'HR_ADMIN', 'MANAGER', 'VIEWER'), c.getHistory);
router.get('/exceptions', requireAuth, requireRole('SUPER_ADMIN', 'HR_ADMIN'), c.exceptions);
router.get('/employee/:employeeId/month/:month', requireAuth, requireEmployeeAccess('employeeId', 'SUPER_ADMIN', 'HR_ADMIN', 'MANAGER', 'VIEWER'), c.employeeMonth);
router.get('/today', requireAuth, c.today);
router.get('/:id/evidence', requireAuth, requireRole('SUPER_ADMIN', 'HR_ADMIN', 'MANAGER', 'VIEWER'), c.getEvidence);
router.post('/:id/correction', requireAuth, requireRole('SUPER_ADMIN', 'HR_ADMIN'), c.correctAttendance);

export default router;