import express, { Router } from 'express';
import * as fotos from './fotos';
import { crearEncuesta } from '../resenas/resenas';
import { fidelidadDeTurno } from '../fidelizacion/fidelizacion';
import { tiqueterasDeTurno } from '../fidelizacion/tiquetera';
import * as ctrl from './appointments.controller';
import { authenticate, requireTenant } from '../../shared/middleware/auth';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { planLimit } from '../../shared/middleware/planLimits';
import { validate, validateId, validarUuid, schemas } from '../../shared/middleware/validate';

const router = Router();
router.use(authenticate, requireTenant);

router.get('/',         validate(schemas.queryListado, 'query'), asyncHandler(ctrl.list));
router.get('/today',    validate(schemas.queryListado, 'query'), asyncHandler(ctrl.today));
router.get('/proximas', asyncHandler(ctrl.proximas));
router.get('/:id',      validateId, asyncHandler(ctrl.getById));
router.post('/',        planLimit('appointments'), validate(schemas.appointmentCreate), asyncHandler(ctrl.create));
router.patch('/:id',    validateId, asyncHandler(ctrl.update));
router.patch('/:id/status', validateId, validate(schemas.statusChange), asyncHandler(ctrl.changeStatus));
router.patch('/:id/adicional', validateId, asyncHandler(ctrl.empezarAdicional));

// Fotos de recepción: el cuerpo es la imagen misma, no JSON. El límite de
// express.raw va un poco por encima del de la foto para que el exceso lo
// rechace el controlador con un mensaje claro.
router.get('/:id/fotos', validateId, asyncHandler(fotos.listar));
router.post(
  '/:id/fotos',
  validateId,
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '2mb' }),
  asyncHandler(fotos.subir),
);
router.delete('/:id/fotos/:fotoId', validarUuid('id', 'fotoId'), asyncHandler(fotos.borrar));
// Encuesta de satisfacción: el panel arma el mensaje de WhatsApp con el token.
router.post('/:id/encuesta', validateId, asyncHandler(crearEncuesta));
router.get('/:id/fidelidad', validateId, asyncHandler(fidelidadDeTurno));
router.get('/:id/tiqueteras', validateId, asyncHandler(tiqueterasDeTurno));
router.patch('/:id/reclamo', validateId, validate(fotos.esquemaReclamo), asyncHandler(fotos.reclamo));
router.post('/quick',   planLimit('appointments'), validate(schemas.appointmentQuick), asyncHandler(ctrl.quickCreate));

export default router;