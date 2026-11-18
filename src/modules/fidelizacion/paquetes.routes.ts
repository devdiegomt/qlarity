/** `/api/paquetes`: las tiqueteras que ofrece el lavadero. Ver tiquetera.ts. */
import { Router } from 'express';
import { authenticate, authorize, requireTenant } from '../../shared/middleware/auth';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { validate, validarUuid } from '../../shared/middleware/validate';
import * as t from './tiquetera';

const router = Router();
router.use(authenticate, requireTenant);
router.get('/', asyncHandler(t.listarPaquetes));
router.post('/', authorize('admin'), validate(t.esquemaPaquete), asyncHandler(t.crearPaquete));
router.patch('/:id', validarUuid('id'), authorize('admin'), validate(t.esquemaPaqueteParche), asyncHandler(t.editarPaquete));

export default router;
