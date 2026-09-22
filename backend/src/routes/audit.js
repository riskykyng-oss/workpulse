import { Router } from 'express';
import * as c from '../controllers/auditController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, requireRole('SUPER_ADMIN', 'HR_ADMIN'), c.list);

export default router;