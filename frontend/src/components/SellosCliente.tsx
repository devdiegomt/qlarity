/**
 * La tarjeta de sellos de un cliente: cuántos lleva y cuánto le falta para el
 * lavado gratis. El operario se lo puede decir al entregar el carro. Los
 * sellos los cuenta el backend a partir de los pagos (ver
 * src/modules/fidelizacion/fidelizacion.ts).
 */
import { useEffect, useState } from 'react';
import { Gift } from 'lucide-react';
import { api } from '../lib/api';

export interface Sellos {
  meta: number;
  sellos: number;
  faltan: number;
  premioDisponible: boolean;
  /** «No vino» en los últimos 90 días. */
  faltas?: number;
}

export default function SellosCliente({ appointmentId }: { appointmentId: string }) {
  const [s, setS] = useState<Sellos | null>(null);
  useEffect(() => {
    api<Sellos>(`/appointments/${appointmentId}/fidelidad`).then(setS).catch(() => setS(null));
  }, [appointmentId]);
  if (!s) return null;
  const aviso = (s.faltas ?? 0) > 0 && (
    <p className="text-sm text-orange-800" data-testid="faltas">
      No vino {s.faltas === 1 ? '1 vez' : `${s.faltas} veces`} en los últimos 90 días
      {(s.faltas ?? 0) >= 2 ? ': no puede reservar por la página web.' : '.'}
    </p>
  );
  if (s.meta <= 0) return aviso || null;

  const total = s.meta - 1;
  return (
    <div className="space-y-2" data-testid="sellos">
      {aviso}
      <div className="flex items-center gap-1.5" aria-label={`${s.sellos} de ${total} sellos`}>
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            aria-hidden="true"
            className={`w-5 h-5 rounded-full border-2 ${i < s.sellos ? 'bg-brand-600 border-brand-600' : 'border-gray-300'}`}
          />
        ))}
        <Gift size={18} aria-hidden="true" className={`ml-1 ${s.premioDisponible ? 'text-green-700' : 'text-gray-400'}`} />
      </div>
      <p className="text-sm text-gray-700">
        {s.premioDisponible
          ? '¡Este lavado le sale gratis! Se aplica al cobrar.'
          : `${s.sellos} de ${total} sellos: le ${s.faltan === 1 ? 'falta 1 lavado' : `faltan ${s.faltan} lavados`} para el gratis.`}
      </p>
    </div>
  );
}
