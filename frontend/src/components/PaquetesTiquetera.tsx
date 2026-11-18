/**
 * Los paquetes de tiquetera del lavadero (Configuración → Servicios): «5
 * lavados completos por $180.000, vencen a los 90 días». Ver
 * src/modules/fidelizacion/tiquetera.ts.
 */
import { useCallback, useEffect, useState } from 'react';
import { Ticket } from 'lucide-react';
import { api } from '../lib/api';
import { formatCOP } from '../lib/format';
import { useToast } from './ui';

export interface Paquete {
  id: string;
  nombre: string;
  service_id: string;
  servicio: string;
  cantidad: number;
  precio: number;
  vigencia_dias: number | null;
  is_active: boolean;
  precio_suelto: number;
}

interface Servicio { id: string; name: string; price_sedan: number; es_adicional?: boolean; is_active?: boolean }

const CAMPO = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none bg-white';

export default function PaquetesTiquetera({ servicios }: { servicios: Servicio[] }) {
  const toast = useToast();
  const [paquetes, setPaquetes] = useState<Paquete[]>([]);
  const [form, setForm] = useState<{ nombre: string; serviceId: string; cantidad: string; precio: string; vigencia: string } | null>(null);

  const lavados = servicios.filter((s) => !s.es_adicional && s.is_active !== false);
  const cargar = useCallback(() => {
    api<Paquete[]>('/paquetes?todos=true').then(setPaquetes).catch(() => setPaquetes([]));
  }, []);
  useEffect(cargar, [cargar]);

  const nuevo = () => {
    const s = lavados[0];
    setForm({ nombre: s ? `5 × ${s.name}` : '', serviceId: s?.id ?? '', cantidad: '5', precio: s ? String(Math.round((s.price_sedan * 5 * 0.9) / 100)) : '', vigencia: '90' });
  };

  const guardar = async () => {
    if (!form) return;
    try {
      await api('/paquetes', {
        method: 'POST',
        body: {
          nombre: form.nombre,
          serviceId: form.serviceId,
          cantidad: parseInt(form.cantidad, 10),
          precio: Math.round(parseFloat(form.precio || '0') * 100),
          vigenciaDias: form.vigencia ? parseInt(form.vigencia, 10) : null,
        },
      });
      setForm(null);
      cargar();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const alternar = async (p: Paquete) => {
    await api(`/paquetes/${p.id}`, { method: 'PATCH', body: { activo: !p.is_active } }).catch((e: Error) => toast.error(e.message));
    cargar();
  };

  const suelto = form ? lavados.find((s) => s.id === form.serviceId)?.price_sedan ?? 0 : 0;
  const ahorro = form && suelto > 0 ? 1 - (parseFloat(form.precio || '0') * 100) / (suelto * parseInt(form.cantidad || '1', 10)) : 0;

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-4" data-testid="paquetes">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold text-gray-900"><Ticket size={17} aria-hidden="true" className="text-brand-600" /> Tiqueteras</h2>
        {!form && (
          <button type="button" onClick={nuevo} className="text-sm font-semibold text-brand-700 hover:text-brand-800">+ Nuevo paquete</button>
        )}
      </div>
      <p className="text-sm text-gray-600">
        Lavados prepagados: el cliente paga por adelantado con descuento y vuelve hasta gastarlos. La plata cuenta como
        ingreso el día de la venta. Se venden desde Clientes.
      </p>

      {paquetes.length > 0 && (
        <ul className="divide-y divide-gray-100">
          {paquetes.map((p) => (
            <li key={p.id} className={`flex items-center justify-between gap-3 py-3 text-sm ${p.is_active ? '' : 'opacity-50'}`}>
              <span className="min-w-0">
                <span className="block font-semibold text-gray-900">{p.nombre}</span>
                <span className="block text-xs text-gray-500">
                  {p.cantidad} × {p.servicio} · {formatCOP(p.precio)}
                  {p.vigencia_dias ? ` · vence a los ${p.vigencia_dias} días` : ' · no vence'}
                </span>
              </span>
              <button type="button" onClick={() => void alternar(p)} className={`text-xs px-2 py-1 ${p.is_active ? 'text-orange-700' : 'text-green-700'}`}>
                {p.is_active ? 'Desactivar' : 'Activar'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {form && (
        <div className="rounded-lg border border-gray-200 p-4 space-y-3">
          <label className="block text-xs text-gray-600">Nombre
            <input className={`${CAMPO} mt-1`} value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs text-gray-600">Lavado
              <select className={`${CAMPO} mt-1`} value={form.serviceId} onChange={(e) => setForm({ ...form, serviceId: e.target.value })}>
                {lavados.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="block text-xs text-gray-600">Cantidad
              <input className={`${CAMPO} mt-1`} type="number" inputMode="numeric" value={form.cantidad} onChange={(e) => setForm({ ...form, cantidad: e.target.value })} />
            </label>
            <label className="block text-xs text-gray-600">Precio ($)
              <input className={`${CAMPO} mt-1`} type="number" inputMode="numeric" value={form.precio} onChange={(e) => setForm({ ...form, precio: e.target.value })} />
            </label>
            <label className="block text-xs text-gray-600">Vence a los (días)
              <input className={`${CAMPO} mt-1`} type="number" inputMode="numeric" placeholder="Vacío: no vence" value={form.vigencia} onChange={(e) => setForm({ ...form, vigencia: e.target.value })} />
            </label>
          </div>
          {ahorro > 0 && <p className="text-xs text-gray-600">El cliente ahorra {Math.round(ahorro * 100)} % frente a pagarlos sueltos (precio de sedán).</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => void guardar()} className="text-sm font-semibold px-4 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700">Crear paquete</button>
            <button type="button" onClick={() => setForm(null)} className="text-sm px-3 py-2 text-gray-600">Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}
