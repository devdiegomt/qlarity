/**
 * A donde vuelve el administrador después de pagar en ePayco
 * (`/plan/pago?ref_payco=…`).
 *
 * El servidor verifica el pago con ePayco —con la firma, igual que la
 * confirmación— y esta página sólo muestra el resultado. Mientras siga en
 * proceso (PSE y efectivo pueden tardar), pregunta de nuevo cada pocos segundos
 * durante un minuto.
 */
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { olvidarSuscripcion } from '../lib/suscripcion';
import { ultimoPago } from '../lib/epayco';

type Estado = 'pendiente' | 'aceptado' | 'rechazado' | 'reversado' | null;

const CADA_MS = 5_000;
const INTENTOS = 12;

export default function PagoResultadoPage() {
  const [params] = useSearchParams();
  const refPayco = params.get('ref_payco') ?? params.get('x_ref_payco') ?? '';
  const propia = ultimoPago();
  const [estado, setEstado] = useState<Estado>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    if (!refPayco && !propia) {
      setCargando(false);
      return;
    }
    let vivo = true;
    let intento = 0;
    let reloj: ReturnType<typeof setTimeout>;
    const preguntar = () => {
      const q = new URLSearchParams();
      if (refPayco) q.set('ref_payco', refPayco);
      if (propia) q.set('referencia', propia);
      api<{ estado: Estado }>(`/suscripcion/verificar?${q}`)
        .then((r) => {
          if (!vivo) return;
          setEstado(r.estado);
          setCargando(false);
          if (r.estado === 'aceptado') olvidarSuscripcion();
          if ((r.estado === 'pendiente' || r.estado === null) && ++intento < INTENTOS) reloj = setTimeout(preguntar, CADA_MS);
        })
        .catch(() => vivo && setCargando(false));
    };
    preguntar();
    return () => {
      vivo = false;
      clearTimeout(reloj);
    };
  }, [refPayco, propia]);

  const vista =
    estado === 'aceptado'
      ? { Icono: CheckCircle2, color: 'text-green-600', titulo: '¡Listo, pago recibido!', texto: 'Tu plan quedó activo. Gracias por confiar en Qlarity.' }
      : estado === 'rechazado' || estado === 'reversado'
        ? { Icono: XCircle, color: 'text-red-600', titulo: 'El pago no se completó', texto: 'No se cobró nada. Puedes intentarlo de nuevo con otro medio de pago.' }
        : { Icono: Clock, color: 'text-brand-700', titulo: cargando ? 'Revisando tu pago…' : 'Tu pago está en proceso', texto: 'Con PSE o efectivo puede tardar unos minutos. Cuando ePayco lo confirme, tu plan se activa solo: puedes seguir usando el panel.' };

  return (
    <div className="max-w-lg mx-auto py-10">
      <div className="bg-white rounded-xl border border-gray-100 p-8 text-center space-y-4" role="status" aria-live="polite">
        <vista.Icono aria-hidden="true" size={44} strokeWidth={1.6} className={`mx-auto ${vista.color}`} />
        <h1 className="text-2xl font-semibold text-gray-900">{vista.titulo}</h1>
        <p className="text-gray-600">{vista.texto}</p>
        {refPayco && <p className="text-xs text-gray-500 font-mono">Referencia ePayco: {refPayco}</p>}
        <Link
          to="/settings?tab=plan"
          reloadDocument={estado === 'aceptado'}
          className="inline-flex items-center justify-center px-5 py-2.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold"
        >
          Ver mi plan
        </Link>
      </div>
    </div>
  );
}
