/**
 * Los turnos pendientes de los próximos días, agrupados por día.
 *
 * El tablero muestra sólo hoy, y las reservas web casi siempre son para otro
 * día: sin esto no aparecían en ninguna parte salvo buscando la fecha a mano
 * en la agenda. Ver `GET /api/appointments/proximas`.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { etiquetaDia, soloFecha } from '../lib/fechas';
import { formatTime } from '../lib/format';
import { Placa } from '../lib/estados';
import EtiquetaWeb from './EtiquetaWeb';
import { MessageCircle } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useToast } from './ui';

interface Proxima {
  id: string;
  scheduled_date: string;
  scheduled_time: string | null;
  plate: string;
  service_name: string;
  customer_first_name: string;
  customer_last_name: string | null;
  customer_phone: string | null;
  source: string;
  por_confirmar?: boolean;
  recordado_at?: string | null;
}

export function useProximas(): Proxima[] | null {
  return useProximasConRecarga()[0];
}

function useProximasConRecarga(): [Proxima[] | null, () => void] {
  const [lista, setLista] = useState<Proxima[] | null>(null);
  const cargar = () => {
    api<Proxima[]>('/appointments/proximas').then(setLista).catch(() => setLista([]));
  };
  useEffect(cargar, []);
  return [lista, cargar];
}

/** El recordatorio que el lavadero manda por WhatsApp el día anterior. */
export function mensajeRecordatorio(t: Proxima, lavadero: string): string {
  const hola = t.customer_first_name && t.customer_first_name !== 'Cliente' ? `Hola ${t.customer_first_name}` : 'Hola';
  const cuando = `${etiquetaDia(soloFecha(t.scheduled_date)).toLowerCase()}${t.scheduled_time ? ` a las ${formatTime(t.scheduled_time)}` : ''}`;
  return `${hola}, te recordamos tu turno en ${lavadero} ${cuando} para ${t.plate} (${t.service_name}). Si no puedes venir, avísanos por aquí para darle el cupo a otra persona. ¡Te esperamos!`;
}

/** Sección completa, para Inicio. */
export default function ProximasReservas() {
  const [lista, recargar] = useProximasConRecarga();
  const { user } = useAuth();
  const toast = useToast();
  if (!lista || lista.length === 0) return null;

  const recordar = (t: Proxima) => {
    if (!t.customer_phone) return;
    window.open(
      `https://wa.me/${t.customer_phone.replace(/\D/g, '')}?text=${encodeURIComponent(mensajeRecordatorio(t, user?.tenant?.name ?? 'el lavadero'))}`,
      '_blank',
    );
    void api(`/appointments/${t.id}/recordado`, { method: 'POST' }).then(recargar).catch(() => undefined);
  };
  const confirmar = async (t: Proxima) => {
    try {
      await api(`/appointments/${t.id}/confirmar`, { method: 'POST' });
      toast.success('Reserva confirmada');
      recargar();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const porDia = new Map<string, Proxima[]>();
  for (const t of lista) {
    const f = soloFecha(t.scheduled_date);
    porDia.set(f, [...(porDia.get(f) ?? []), t]);
  }

  return (
    <section className="space-y-4" aria-labelledby="proximas-titulo">
      <div className="flex items-baseline justify-between">
        <h2 id="proximas-titulo" className="text-base font-semibold text-gray-900">
          Próximas reservas <span className="font-mono text-sm text-gray-500">{lista.length}</span>
        </h2>
      </div>
      <div className="space-y-5">
        {[...porDia.entries()].map(([fecha, turnos]) => (
          <div key={fecha} className="space-y-2">
            <div className="flex items-baseline justify-between">
              <p className="etiqueta font-semibold text-gray-500 first-letter:uppercase">{etiquetaDia(fecha)}</p>
              <Link to={`/appointments?fecha=${fecha}`} className="text-xs text-brand-700 hover:text-brand-800 font-medium">
                Ver en la agenda
              </Link>
            </div>
            <ul className="bg-white border border-gray-100 rounded-xl divide-y divide-gray-100">
              {turnos.map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <span className="font-mono text-xs text-gray-700 w-20 shrink-0 whitespace-nowrap">
                    {t.scheduled_time ? formatTime(t.scheduled_time) : '—'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 flex-wrap">
                      <Placa placa={t.plate} />
                      <EtiquetaWeb source={t.source} />
                      {t.por_confirmar && (
                        <span className="text-[0.68rem] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border border-orange-600/50 text-orange-800 bg-orange-50">
                          Por confirmar
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-gray-500 mt-1 truncate">
                      {t.service_name} · {t.customer_first_name} {t.customer_last_name ?? ''}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1.5 shrink-0">
                    {t.por_confirmar && (
                      <button type="button" onClick={() => void confirmar(t)} className="text-xs font-semibold text-green-700 hover:text-green-800">
                        Confirmar
                      </button>
                    )}
                    {t.customer_phone && (
                      <button
                        type="button"
                        onClick={() => recordar(t)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-800"
                        title="Abre WhatsApp con un recordatorio listo"
                      >
                        <MessageCircle size={13} aria-hidden="true" />
                        {t.recordado_at ? 'Recordado ✓' : 'Recordar'}
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
