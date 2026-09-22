import { Router } from 'express';
import * as c from '../controllers/rulesController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, requireRole('SUPER_ADMIN', 'HR_ADMIN'), c.get);
router.put('/', requireAuth, requireRole('SUPER_ADMIN', 'HR_ADMIN'), c.update);

export default router;