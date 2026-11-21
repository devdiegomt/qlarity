/**
 * Rutas de la mensualidad:
 *
 * - `/api/suscripcion/*`, con sesión: crear el pago, verificarlo al volver del
 *   checkout y ver el historial. Pagar es cosa del administrador.
 * - `/api/epayco/confirmacion`, sin sesión: la llama el servidor de ePayco. Lo
 *   que la protege es la firma (ver epayco.ts), no quién la llama. El lavadero
 *   se encuentra por la referencia del pago, igual que las páginas públicas
 *   por su slug (abrirContextoResolviendo).
 */
import express, { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticate, authorize, requireTenant } from '../../shared/middleware/auth';
import { abrirContextoResolviendo } from '../../shared/middleware/rls';
import { validate } from '../../shared/middleware/validate';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { crearCheckout, esquemaCheckout, listarPagos, procesarConfirmacion, verificar, type DatosEpayco } from './suscripcion';

export const suscripcionRoutes = Router();
suscripcionRoutes.use(authenticate, requireTenant);

suscripcionRoutes.post(
  '/checkout',
  authorize('admin'),
  validate(esquemaCheckout),
  asyncHandler(async (req: Request, res: Response) => {
    res.status(201).json(await crearCheckout(req));
  }),
);

suscripcionRoutes.get(
  '/verificar',
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      await verificar(
        req.tenantId!,
        String(req.query.ref_payco ?? ''),
        req.query.referencia ? String(req.query.referencia) : undefined,
      ),
    );
  }),
);

suscripcionRoutes.get(
  '/pagos',
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await listarPagos(req.tenantId!));
  }),
);

export const confirmacionEpaycoRoutes = Router();

// ePayco manda la confirmación como formulario (POST) o en la URL (GET),
// según cómo esté configurada la cuenta: se aceptan las dos.
const datos = (req: Request): DatosEpayco => ({
  ...(req.query as DatosEpayco),
  ...((req.body ?? {}) as DatosEpayco),
});

const confirmar = [
  abrirContextoResolviendo(
    (req) => {
      const d = datos(req);
      const ref = String(d.x_id_invoice ?? d.x_extra1 ?? '').trim();
      return /^QL[0-9A-Z]{6,30}$/.test(ref) ? ref : null;
    },
    'SELECT tenant_id AS id FROM pagos_suscripcion WHERE referencia = $1',
    'Pago no encontrado',
  ),
  asyncHandler(async (req: Request, res: Response) => {
    // abrirContextoResolviendo dejó en req.tenantId el lavadero del pago.
    const r = await procesarConfirmacion(datos(req), req.tenantId!);
    // Firma o monto que no cuadran: 400 y nada cambia. Lo demás, 200, para que
    // ePayco no siga reintentando algo ya procesado.
    res.status(r.ignorado ? 400 : 200).json({ estado: r.estado, ...(r.ignorado ? { error: r.ignorado } : {}) });
  }),
];

confirmacionEpaycoRoutes.post(
  '/confirmacion',
  express.urlencoded({ extended: false, limit: '20kb' }),
  ...confirmar,
);
confirmacionEpaycoRoutes.get('/confirmacion', ...confirmar);
