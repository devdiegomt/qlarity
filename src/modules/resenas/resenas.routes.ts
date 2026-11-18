/** `GET /api/calificaciones`: el resumen de calificaciones, para el dueño. */
import { Router } from 'express';
import { authenticate, authorize, requireTenant } from '../../shared/middleware/auth';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { resumen } from './resenas';

const router = Router();
router.use(authenticate, requireTenant);
router.get('/', authorize('admin'), asyncHandler(resumen));

export default router;
