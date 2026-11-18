/**
 * Las tiqueteras de un cliente y la venta de una nueva (desde Clientes).
 */
import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../lib/api';
import { formatCOP } from '../lib/format';
import { METODOS_PAGO } from '../lib/metodos-pago';
import type { PaymentMethod } from '../types';
import { useToast } from './ui';
import type { Paquete } from './PaquetesTiquetera';
import { fechaCorta } from '../lib/fechas';

interface Tiquetera {
  id: string;
  nombre: string;
  servicio: string;
  cantidad: number;
  usados: number;
  quedan: number;
  precio: number;
  vence_el: string | null;
  vencida: boolean;
  agotada: boolean;
}

export default function TiqueteraCliente({ cliente, onClose }: { cliente: { id: string; nombre: string }; onClose(): void }) {
  const toast = useToast();
  const [tiqueteras, setTiqueteras] = useState<Tiquetera[] | null>(null);
  const [paquetes, setPaquetes] = useState<Paquete[]>([]);
  const [paqueteId, setPaqueteId] = useState('');
  const [metodo, setMetodo] = useState<PaymentMethod>('cash');
  const [vendiendo, setVendiendo] = useState(false);

  const cargar = useCallback(() => {
    api<Tiquetera[]>(`/customers/${cliente.id}/tiqueteras`).then(setTiqueteras).catch(() => setTiqueteras([]));
  }, [cliente.id]);
  useEffect(() => {
    cargar();
    api<Paquete[]>('/paquetes').then((p) => {
      setPaquetes(p);
      setPaqueteId(p[0]?.id ?? '');
    }).catch(() => setPaquetes([]));
  }, [cargar]);

  const vender = async () => {
    setVendiendo(true);
    try {
      await api(`/customers/${cliente.id}/tiqueteras`, { method: 'POST', body: { paqueteId, metodoPago: metodo } });
      toast.success('Tiquetera vendida');
      cargar();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setVendiendo(false);
    }
  };

  const elegido = paquetes.find((p) => p.id === paqueteId);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" role="dialog" aria-label={`Tiqueteras de ${cliente.nombre}`}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white border border-gray-100 w-full max-w-md rounded-t-xl sm:rounded-xl p-5 space-y-5 max-h-[90vh] overflow-y-auto shadow-2xl shadow-sombra">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Tiqueteras de {cliente.nombre}</h2>
          <button onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-800 p-1"><X size={20} aria-hidden="true" /></button>
        </div>

        {tiqueteras && tiqueteras.length > 0 ? (
          <ul className="space-y-2">
            {tiqueteras.map((t) => (
              <li key={t.id} className={`rounded-lg border p-3 text-sm ${t.vencida || t.agotada ? 'border-gray-100 opacity-60' : 'border-brand-300 bg-brand-50'}`}>
                <p className="font-semibold text-gray-900">{t.nombre}</p>
                <p className="text-gray-700">
                  Le quedan <strong>{t.quedan}</strong> de {t.cantidad} · {t.servicio}
                </p>
                <p className="text-xs text-gray-500">
                  {t.agotada ? 'Agotada' : t.vencida ? `Venció el ${fechaCorta(t.vence_el!)}` : t.vence_el ? `Vence el ${fechaCorta(t.vence_el)}` : 'No vence'}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          tiqueteras && <p className="text-sm text-gray-500">No tiene tiqueteras.</p>
        )}

        <div className="border-t border-gray-100 pt-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-900">Vender una tiquetera</h3>
          {paquetes.length === 0 ? (
            <p className="text-sm text-gray-500">Primero crea un paquete en Configuración → Servicios → Tiqueteras.</p>
          ) : (
            <>
              <select
                aria-label="Paquete"
                value={paqueteId}
                onChange={(e) => setPaqueteId(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-brand-500 outline-none"
              >
                {paquetes.map((p) => (
                  <option key={p.id} value={p.id}>{p.nombre} · {formatCOP(p.precio)}</option>
                ))}
              </select>
              {elegido && (
                <p className="text-xs text-gray-600">
                  {elegido.cantidad} × {elegido.servicio}
                  {elegido.vigencia_dias ? `. Vence a los ${elegido.vigencia_dias} días: díselo al cliente.` : '. No vence.'}
                </p>
              )}
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Método de pago">
                {METODOS_PAGO.map((m) => (
                  <button key={m.value} type="button" role="radio" aria-checked={metodo === m.value} onClick={() => setMetodo(m.value)}
                    className={`py-2 rounded-lg border text-xs font-medium ${metodo === m.value ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-gray-200 text-gray-600'}`}>
                    {m.label}
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => void vender()} disabled={vendiendo || !paqueteId}
                className="w-full py-3 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-lg text-sm disabled:opacity-50">
                {vendiendo ? 'Vendiendo…' : `Cobrar ${elegido ? formatCOP(elegido.precio) : ''} y entregar tiquetera`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
