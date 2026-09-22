import { Router } from 'express';
import * as c from '../controllers/departmentController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, requireRole('SUPER_ADMIN', 'HR_ADMIN', 'MANAGER', 'VIEWER'), c.list);
router.get('/:id', requireAuth, requireRole('SUPER_ADMIN', 'HR_ADMIN', 'MANAGER', 'VIEWER'), c.detail);

export default router;