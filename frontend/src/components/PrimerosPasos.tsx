/**
 * «Primeros pasos»: la guía de Inicio para un lavadero que recién empieza.
 *
 * Seis pasos que se marcan solos a medida que se hacen (ver
 * src/modules/primeros-pasos/primeros-pasos.ts). Cada uno lleva a la pantalla
 * donde se hace. Desaparece al completarlos o si el dueño la cierra. Sólo la
 * ve el administrador: es quien configura.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, X } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useToast } from './ui';

type Clave = 'datos' | 'horario' | 'servicios' | 'equipo' | 'reservas' | 'turno';

interface Estado {
  cerrado: boolean;
  pasos: Array<{ clave: Clave; hecho: boolean }>;
  completos: number;
}

const TEXTOS: Record<Clave, { titulo: string; texto: string; ir: string; boton: string }> = {
  datos: {
    titulo: 'Completa los datos del lavadero',
    texto: 'Dirección y teléfono: salen en tu página de reservas y en el aviso de privacidad.',
    ir: '/settings',
    boton: 'Ir a Configuración',
  },
  horario: {
    titulo: 'Revisa tu horario y tus bahías',
    texto: 'Con eso se calculan los horarios que tus clientes pueden reservar.',
    ir: '/settings',
    boton: 'Revisar',
  },
  servicios: {
    titulo: 'Ajusta tus servicios y precios',
    texto: 'Dejamos unos de ejemplo. ¿No sabes cuánto cobrar? Usa la calculadora de precios.',
    ir: '/settings?tab=services',
    boton: 'Ver servicios',
  },
  equipo: {
    titulo: 'Agrega a tu equipo',
    texto: 'Cada lavador entra con su usuario y ve el tablero desde su celular.',
    ir: '/settings?tab=team',
    boton: 'Agregar',
  },
  reservas: {
    titulo: 'Comparte tu página de reservas',
    texto: 'Ponla en tu Instagram o WhatsApp: tus clientes reservan solos y aparece en tu agenda.',
    ir: '/settings',
    boton: 'Ver enlace',
  },
  turno: {
    titulo: 'Registra tu primer turno',
    texto: 'Cuando llegue un carro, toca «Nuevo turno» arriba: placa, servicio y listo.',
    ir: '/board',
    boton: 'Ir al tablero',
  },
};

export default function PrimerosPasos() {
  const { user } = useAuth();
  const toast = useToast();
  const esAdmin = user?.role === 'admin';
  const [estado, setEstado] = useState<Estado | null>(null);

  const cargar = useCallback(() => {
    api<Estado>('/tenants/me/primeros-pasos').then(setEstado).catch(() => setEstado(null));
  }, []);
  useEffect(() => {
    if (esAdmin) cargar();
  }, [esAdmin, cargar]);

  if (!esAdmin || !estado || estado.cerrado || estado.completos === estado.pasos.length) return null;

  const marcar = async (body: { paso: Clave } | { cerrar: true }) => {
    try {
      setEstado(await api<Estado>('/tenants/me/primeros-pasos', { method: 'POST', body }));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const siguiente = estado.pasos.find((p) => !p.hecho)?.clave;
  return (
    <section className="bg-white border border-brand-300 rounded-xl p-5" aria-labelledby="primeros-pasos-titulo">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="primeros-pasos-titulo" className="text-base font-semibold text-gray-900">Primeros pasos</h2>
          <p className="text-sm text-gray-600 mt-0.5">
            {estado.completos} de {estado.pasos.length} listos. Así dejas tu lavadero funcionando.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void marcar({ cerrar: true })}
          aria-label="Ocultar primeros pasos"
          title="Ocultar"
          className="p-1.5 text-gray-400 hover:text-gray-800 rounded-lg hover:bg-gray-100"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="mt-3 h-1.5 rounded-full bg-gray-100 overflow-hidden" aria-hidden="true">
        <div className="h-full bg-brand-600 transition-all" style={{ width: `${(estado.completos / estado.pasos.length) * 100}%` }} />
      </div>
      <ol className="mt-4 space-y-2">
        {estado.pasos.map((p, i) => {
          const t = TEXTOS[p.clave];
          const actual = p.clave === siguiente;
          return (
            <li key={p.clave} className={`flex items-start gap-3 rounded-lg p-3 ${actual ? 'bg-brand-50' : ''}`}>
              <span
                className={`mt-0.5 flex items-center justify-center w-6 h-6 rounded-full shrink-0 text-xs font-semibold ${
                  p.hecho ? 'bg-green-600 text-white' : actual ? 'border-2 border-brand-600 text-brand-800' : 'border border-gray-300 text-gray-500'
                }`}
                aria-hidden="true"
              >
                {p.hecho ? <Check size={14} strokeWidth={3} /> : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-sm font-semibold ${p.hecho ? 'text-gray-500 line-through' : 'text-gray-900'}`}>
                  {t.titulo}
                  <span className="sr-only">{p.hecho ? ' (listo)' : ''}</span>
                </span>
                {!p.hecho && <span className="block text-xs text-gray-600 mt-0.5">{t.texto}</span>}
                {!p.hecho && actual && (
                  <span className="flex flex-wrap gap-3 mt-2">
                    <Link
                      to={t.ir}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700"
                    >
                      {t.boton}
                    </Link>
                    {p.clave === 'equipo' && (
                      <button type="button" onClick={() => void marcar({ paso: 'equipo' })} className="text-xs font-semibold text-gray-600 hover:text-gray-900">
                        Trabajo solo
                      </button>
                    )}
                    {p.clave === 'servicios' && (
                      <a href="/calculadora" target="_blank" rel="noopener" className="text-xs font-semibold text-brand-700 hover:text-brand-800">
                        Calculadora de precios
                      </a>
                    )}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
