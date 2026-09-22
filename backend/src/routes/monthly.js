import { Router } from 'express';
import * as c from '../controllers/monthlyController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, requireRole('SUPER_ADMIN', 'HR_ADMIN', 'VIEWER'), c.list);
router.get('/:month', requireAuth, requireRole('SUPER_ADMIN', 'HR_ADMIN', 'VIEWER'), c.get);
router.get('/:month/export', requireAuth, requireRole('SUPER_ADMIN', 'HR_ADMIN', 'VIEWER'), c.exportMonthly);
router.post('/:month/compile', requireAuth, requireRole('SUPER_ADMIN', 'HR_ADMIN'), c.compile);
router.post('/:month/close', requireAuth, requireRole('SUPER_ADMIN', 'HR_ADMIN'), c.close);
router.post('/:month/reopen', requireAuth, requireRole('SUPER_ADMIN', 'HR_ADMIN'), c.reopen);

export default router;