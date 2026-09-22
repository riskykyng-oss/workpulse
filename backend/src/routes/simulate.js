import { Router } from 'express';
import * as c from '../controllers/simulateController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/status', requireAuth, requireRole('SUPER_ADMIN', 'HR_ADMIN'), c.status);
router.post('/arrival', requireAuth, requireRole('SUPER_ADMIN', 'HR_ADMIN'), c.simulateArrival);
router.post('/departure', requireAuth, requireRole('SUPER_ADMIN', 'HR_ADMIN'), c.simulateDeparture);
router.post('/lunch', requireAuth, requireRole('SUPER_ADMIN', 'HR_ADMIN'), c.simulateLunch);
router.post('/unknown-device', requireAuth, requireRole('SUPER_ADMIN', 'HR_ADMIN'), c.simulateUnknownDevice);
router.post('/outage', requireAuth, requireRole('SUPER_ADMIN', 'HR_ADMIN'), c.simulateOutage);

export default router;