import * as tiquetera from '../fidelizacion/tiquetera';
import * as fidelizacion from '../fidelizacion/fidelizacion';
import { Router } from 'express';
import * as ctrl from './customers.controller';
import { authenticate, authorize, requireTenant } from '../../shared/middleware/auth';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { validate, validarUuid, schemas } from '../../shared/middleware/validate';

const router = Router();
router.use(authenticate, requireTenant);

router.get('/',                validate(schemas.queryListado, 'query'), asyncHandler(ctrl.list));
// Antes de '/:id': si no, «sin-volver» se tomaría por un id.
router.get('/sin-volver',      asyncHandler(fidelizacion.sinVolver));
router.get('/:id',             validarUuid('id'), asyncHandler(ctrl.getById));
router.post('/',               validate(schemas.customerCreate), asyncHandler(ctrl.create));
router.patch('/:id',           validarUuid('id'), validate(schemas.customerUpdate), asyncHandler(ctrl.update));
router.delete('/:id',          validarUuid('id'), asyncHandler(ctrl.remove));
// Supresion de datos personales (Ley 1581). Es irreversible y distinta del
// DELETE de arriba, que solo hace borrado logico y conserva los datos.
router.post('/:id/anonimizar', validarUuid('id'), authorize('admin'), asyncHandler(ctrl.anonimizar));
router.get('/:id/vehicles',    validarUuid('id'), asyncHandler(ctrl.getVehicles));
router.get('/:id/history',     validarUuid('id'), asyncHandler(ctrl.getHistory));
router.get('/:id/fidelidad',   validarUuid('id'), asyncHandler(fidelizacion.fidelidadDeCliente));
router.post('/:id/invitado',   validarUuid('id'), asyncHandler(fidelizacion.marcarInvitado));
router.get('/:id/tiqueteras',  validarUuid('id'), asyncHandler(tiquetera.tiqueterasDeCliente));
router.post('/:id/tiqueteras', validarUuid('id'), validate(tiquetera.esquemaVenta), asyncHandler(tiquetera.venderTiquetera));

export default router;