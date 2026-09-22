import { Router } from 'express';
import * as c from '../controllers/deviceController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, requireRole('SUPER_ADMIN', 'HR_ADMIN', 'MANAGER', 'VIEWER'), c.list);
router.post('/', requireAuth, requireRole('SUPER_ADMIN', 'HR_ADMIN'), c.register);
router.patch('/:id/primary', requireAuth, requireRole('SUPER_ADMIN', 'HR_ADMIN'), c.setPrimary);
router.patch('/:id/deactivate', requireAuth, requireRole('SUPER_ADMIN', 'HR_ADMIN'), c.deactivate);

export default router;