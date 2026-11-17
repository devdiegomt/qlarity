/**
 * Marca un turno que el cliente reservó solo, desde la página de reservas.
 *
 * Sirve para que el lavadero distinga, de un vistazo, los turnos que nadie del
 * equipo tomó: son los que conviene confirmar o esperar con más atención.
 */
import { Globe } from 'lucide-react';

export default function EtiquetaWeb({ source }: { source?: string | null }) {
  if (source !== 'web') return null;
  return (
    <span
      className="inline-flex items-center gap-1 text-[0.68rem] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border border-brand-300 text-brand-800 bg-brand-50"
      title="Reservado por el cliente desde la página de reservas"
    >
      <Globe size={11} aria-hidden="true" /> Web
    </span>
  );
}
