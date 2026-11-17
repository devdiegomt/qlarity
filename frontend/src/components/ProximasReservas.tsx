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

interface Proxima {
  id: string;
  scheduled_date: string;
  scheduled_time: string | null;
  plate: string;
  service_name: string;
  customer_first_name: string;
  customer_last_name: string | null;
  source: string;
}

export function useProximas(): Proxima[] | null {
  const [lista, setLista] = useState<Proxima[] | null>(null);
  useEffect(() => {
    api<Proxima[]>('/appointments/proximas').then(setLista).catch(() => setLista([]));
  }, []);
  return lista;
}

/** Sección completa, para Inicio. */
export default function ProximasReservas() {
  const lista = useProximas();
  if (!lista || lista.length === 0) return null;

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
                  <span className="font-mono text-xs text-gray-700 w-16 shrink-0">
                    {t.scheduled_time ? formatTime(t.scheduled_time) : '—'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 flex-wrap">
                      <Placa placa={t.plate} />
                      <EtiquetaWeb source={t.source} />
                    </span>
                    <span className="block text-xs text-gray-500 mt-1 truncate">
                      {t.service_name} · {t.customer_first_name} {t.customer_last_name ?? ''}
                    </span>
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
