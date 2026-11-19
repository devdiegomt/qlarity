/**
 * Una pantalla vacía que explica: qué es la sección y cuál es la primera
 * acción, con el botón ahí. Antes una sección vacía decía «Sin turnos» y nada
 * más, y quien entraba por primera vez no sabía qué hacer.
 */
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export default function Vacio({ icono: Icono, titulo, children, accion }: {
  icono: LucideIcon;
  titulo: string;
  children: ReactNode;
  accion?: ReactNode;
}) {
  return (
    <div className="text-center py-12 px-4 max-w-md mx-auto">
      <Icono aria-hidden="true" size={36} strokeWidth={1.3} className="mx-auto mb-4 text-gray-400" />
      <p className="font-semibold text-gray-900">{titulo}</p>
      <div className="text-sm text-gray-600 mt-2 leading-relaxed">{children}</div>
      {accion && <div className="mt-5">{accion}</div>}
    </div>
  );
}
