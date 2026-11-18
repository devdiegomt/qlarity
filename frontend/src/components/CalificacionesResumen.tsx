/**
 * Lo que dicen los clientes: promedio, cuántos respondieron, distribución de
 * estrellas y los últimos comentarios. Va en Reportes.
 */
import { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import { api } from '../lib/api';

interface Resumen {
  dias: number;
  enviadas: number;
  respondidas: number;
  promedio: number | null;
  aGoogle: number;
  distribucion: Record<string, number>;
  recientes: Array<{ estrellas: number; comentario: string | null; fecha: string; placa: string; cliente: string | null; servicio: string }>;
}

export default function CalificacionesResumen() {
  const [r, setR] = useState<Resumen | null>(null);
  useEffect(() => {
    api<Resumen>('/calificaciones?dias=30').then(setR).catch(() => setR(null));
  }, []);
  if (!r) return null;

  const max = Math.max(1, ...Object.values(r.distribucion));
  return (
    <section className="bg-white rounded-xl border border-gray-100 p-5 space-y-5" aria-labelledby="calif-titulo">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 id="calif-titulo" className="text-base font-semibold text-gray-900">Lo que dicen tus clientes</h2>
        <span className="text-xs text-gray-500">Últimos {r.dias} días</span>
      </div>
      {r.enviadas === 0 ? (
        <p className="text-sm text-gray-600">
          Todavía no has enviado encuestas. Al entregar un carro, ábrelo en el tablero y toca «Enviar encuesta por
          WhatsApp».
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Cifra etiqueta="Promedio" valor={r.promedio === null ? '—' : `${r.promedio.toLocaleString('es-CO')} ★`} />
            <Cifra etiqueta="Respondieron" valor={`${r.respondidas} de ${r.enviadas}`} />
            <Cifra etiqueta="Fueron a Google" valor={String(r.aGoogle)} />
          </div>
          <ul className="space-y-1.5" aria-label="Distribución de estrellas">
            {[5, 4, 3, 2, 1].map((n) => (
              <li key={n} className="flex items-center gap-3 text-sm">
                <span className="w-8 text-gray-600 font-mono">{n} ★</span>
                <span className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                  <span className="block h-full bg-brand-600" style={{ width: `${(r.distribucion[n] / max) * 100}%` }} />
                </span>
                <span className="w-6 text-right font-mono text-gray-700">{r.distribucion[n]}</span>
              </li>
            ))}
          </ul>
          {r.recientes.some((x) => x.comentario) && (
            <div className="space-y-3">
              <h3 className="etiqueta text-gray-500">Comentarios recientes</h3>
              <ul className="divide-y divide-gray-100">
                {r.recientes
                  .filter((x) => x.comentario)
                  .slice(0, 8)
                  .map((x, i) => (
                    <li key={i} className="py-3 text-sm">
                      <p className="flex items-center gap-2 text-gray-900">
                        <span className="inline-flex text-brand-600" aria-label={`${x.estrellas} estrellas`}>
                          {Array.from({ length: 5 }, (_, k) => (
                            <Star key={k} size={13} aria-hidden="true" fill={k < x.estrellas ? 'currentColor' : 'none'} />
                          ))}
                        </span>
                        <span className="text-xs text-gray-500">
                          {x.cliente ?? 'Cliente'} · {x.placa} · {new Date(x.fecha).toLocaleDateString('es-CO')}
                        </span>
                      </p>
                      <p className="text-gray-700 mt-1">{x.comentario}</p>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Cifra({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <p className="etiqueta text-gray-500">{etiqueta}</p>
      <p className="cifra text-xl font-semibold text-gray-900 mt-1 whitespace-nowrap">{valor}</p>
    </div>
  );
}
