/**
 * «Clientes que no han vuelto»: los que llevan más de N días sin venir (N en
 * Configuración), con un botón que abre WhatsApp con una invitación lista y el
 * enlace de reservas. Al invitar a alguien deja de aparecer por dos semanas.
 * Va en Inicio.
 */
import { useCallback, useEffect, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from './ui';
import type { Sellos } from './SellosCliente';

interface Cliente {
  id: string;
  nombre: string | null;
  telefono: string;
  diasSinVenir: number;
  visitas: number;
  placa: string | null;
  servicio: string | null;
}

interface Invitacion {
  nombre: string | null;
  telefono: string | null;
  lavadero: string;
  slug: string;
  sellos: Sellos;
}

export function mensajeInvitacion(c: Pick<Cliente, 'placa' | 'diasSinVenir'>, inv: Invitacion, origen: string): string {
  const hola = inv.nombre && inv.nombre !== 'Cliente' ? `Hola ${inv.nombre}` : 'Hola';
  const carro = c.placa ? `tu vehículo ${c.placa}` : 'tu vehículo';
  let texto = `${hola}, te extrañamos en ${inv.lavadero}. ${carro[0].toUpperCase()}${carro.slice(1)} lleva ${c.diasSinVenir} días sin un lavado.`;
  if (inv.sellos.meta > 0) {
    texto += inv.sellos.premioDisponible
      ? ' ¡Tu próximo lavado es gratis!'
      : ` Llevas ${inv.sellos.sellos} de ${inv.sellos.meta - 1} sellos: te ${inv.sellos.faltan === 1 ? 'falta 1' : `faltan ${inv.sellos.faltan}`} para tu lavado gratis.`;
  }
  return `${texto} Reserva tu turno aquí: ${origen}/reservar/${inv.slug}`;
}

export default function ClientesSinVolver() {
  const toast = useToast();
  const [datos, setDatos] = useState<{ dias: number; clientes: Cliente[] } | null>(null);
  const [todos, setTodos] = useState(false);

  const cargar = useCallback(() => {
    api<{ dias: number; clientes: Cliente[] }>('/customers/sin-volver').then(setDatos).catch(() => setDatos(null));
  }, []);
  useEffect(cargar, [cargar]);

  if (!datos || datos.dias === 0 || datos.clientes.length === 0) return null;

  const invitar = async (c: Cliente) => {
    // La ventana antes del await: en el celular, una que se abre después la bloquea el navegador.
    const ventana = window.open('about:blank', '_blank');
    try {
      const inv = await api<Invitacion>(`/customers/${c.id}/invitado`, { method: 'POST' });
      const destino = `https://wa.me/${c.telefono.replace(/\D/g, '')}?text=${encodeURIComponent(mensajeInvitacion(c, inv, window.location.origin))}`;
      if (ventana) ventana.location.href = destino;
      else window.location.href = destino;
      setDatos((d) => (d ? { ...d, clientes: d.clientes.filter((x) => x.id !== c.id) } : d));
    } catch (e) {
      ventana?.close();
      toast.error((e as Error).message);
    }
  };

  const visibles = todos ? datos.clientes : datos.clientes.slice(0, 5);
  return (
    <section className="space-y-3" aria-labelledby="sin-volver-titulo">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="sin-volver-titulo" className="text-base font-semibold text-gray-900">
          Clientes que no han vuelto <span className="font-mono text-sm text-gray-500">{datos.clientes.length}</span>
        </h2>
        <span className="text-xs text-gray-500">Más de {datos.dias} días sin venir</span>
      </div>
      <ul className="bg-white border border-gray-100 rounded-xl divide-y divide-gray-100">
        {visibles.map((c) => (
          <li key={c.id} className="flex items-center gap-3 px-4 py-3 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-gray-900 truncate">{c.nombre ?? 'Cliente'}</span>
              <span className="block text-xs text-gray-500 truncate">
                {c.diasSinVenir} días · {c.visitas} {c.visitas === 1 ? 'visita' : 'visitas'}
                {c.placa ? ` · ${c.placa}` : ''}
              </span>
            </span>
            <button
              type="button"
              onClick={() => void invitar(c)}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-brand-400 text-brand-800 text-xs font-semibold hover:bg-brand-50 transition"
            >
              <MessageCircle size={14} aria-hidden="true" /> Invitar
            </button>
          </li>
        ))}
      </ul>
      {datos.clientes.length > 5 && !todos && (
        <button type="button" onClick={() => setTodos(true)} className="text-sm text-brand-700 hover:text-brand-800 font-medium">
          Ver los {datos.clientes.length}
        </button>
      )}
    </section>
  );
}
