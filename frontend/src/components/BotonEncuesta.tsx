/**
 * «Enviar encuesta por WhatsApp»: abre el WhatsApp del celular con un mensaje
 * listo para el cliente y el enlace a su encuesta. No necesita el bot: el
 * mensaje sale del número del lavadero, como cualquier otro.
 *
 * La ventana se abre antes de pedir el enlace al servidor: en el celular, una
 * ventana que se abre después de un `await` la bloquea el navegador.
 */
import { MessageCircleHeart } from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from './ui';

interface Encuesta {
  token: string;
  respondida: boolean;
  cliente: string | null;
  telefono: string | null;
  lavadero: string;
}

export function mensajeEncuesta(e: Encuesta, url: string): string {
  const saludo = e.cliente && e.cliente !== 'Cliente' ? `Hola ${e.cliente}` : 'Hola';
  return `${saludo}, gracias por traer tu vehículo a ${e.lavadero}. ¿Cómo te fue? Califícanos aquí, toma 10 segundos: ${url}`;
}

export default function BotonEncuesta({ appointmentId, compacto = false }: { appointmentId: string; compacto?: boolean }) {
  const toast = useToast();

  const enviar = async () => {
    const ventana = window.open('about:blank', '_blank');
    try {
      const e = await api<Encuesta>(`/appointments/${appointmentId}/encuesta`, { method: 'POST' });
      const url = `${window.location.origin}/calificar/${e.token}`;
      if (e.respondida) toast.success('Este cliente ya respondió la encuesta');
      if (e.telefono) {
        const destino = `https://wa.me/${e.telefono.replace(/\D/g, '')}?text=${encodeURIComponent(mensajeEncuesta(e, url))}`;
        if (ventana) ventana.location.href = destino;
        else window.location.href = destino;
      } else {
        ventana?.close();
        await navigator.clipboard.writeText(url).catch(() => undefined);
        toast.success('El cliente no tiene teléfono: copié el enlace de la encuesta');
      }
    } catch (err) {
      ventana?.close();
      toast.error((err as Error).message);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void enviar()}
      className={
        compacto
          ? 'text-xs font-semibold text-brand-700 hover:text-brand-800 inline-flex items-center gap-1'
          : 'w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg border border-brand-400 text-brand-800 text-sm font-semibold hover:bg-brand-50 transition'
      }
    >
      <MessageCircleHeart size={compacto ? 14 : 16} aria-hidden="true" />
      Enviar encuesta por WhatsApp
    </button>
  );
}
