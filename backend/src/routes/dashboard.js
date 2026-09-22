import { Router } from 'express';
import { dashboard } from '../controllers/dashboardController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, requireRole('SUPER_ADMIN', 'HR_ADMIN', 'MANAGER', 'VIEWER'), dashboard);

export default router;