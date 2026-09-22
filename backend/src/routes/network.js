import { Router } from 'express';
import * as c from '../controllers/networkController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/status', requireAuth, c.status);

export default router;