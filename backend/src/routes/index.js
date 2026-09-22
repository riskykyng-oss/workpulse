import { Router } from 'express';
import authRoutes from './auth.js';
import dashboardRoutes from './dashboard.js';
import attendanceRoutes from './attendance.js';
import departmentRoutes from './departments.js';
import employeeRoutes from './employees.js';
import deviceRoutes from './devices.js';
import rulesRoutes from './rules.js';
import monthlyRoutes from './monthly.js';
import auditRoutes from './audit.js';
import networkRoutes from './network.js';
import simulateRoutes from './simulate.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/attendance', attendanceRoutes);
router.use('/departments', departmentRoutes);
router.use('/employees', employeeRoutes);
router.use('/devices', deviceRoutes);
router.use('/rules', rulesRoutes);
router.use('/monthly', monthlyRoutes);
router.use('/audit', auditRoutes);
router.use('/network', networkRoutes);
router.use('/simulate', simulateRoutes);

export default router;