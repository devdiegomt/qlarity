/**
 * Una pista corta la primera vez que alguien entra a una sección: qué es y qué
 * se hace ahí. Se cierra y no vuelve a salir en ese navegador.
 *
 * Es una comodidad, no un dato: vive en localStorage (por navegador). Si el
 * navegador no deja guardar —ventana privada—, la pista simplemente se puede
 * cerrar cada vez.
 */
import { useState, type ReactNode } from 'react';
import { Lightbulb, X } from 'lucide-react';

const clave = (id: string) => `qlarity:pista:${id}`;

function vista(id: string): boolean {
  try {
    return localStorage.getItem(clave(id)) === '1';
  } catch {
    return false;
  }
}

export default function PistaPrimeraVez({ id, children }: { id: string; children: ReactNode }) {
  const [oculta, setOculta] = useState(() => vista(id));
  if (oculta) return null;
  const cerrar = () => {
    try {
      localStorage.setItem(clave(id), '1');
    } catch {
      // Sin almacenamiento, la pista se cierra sólo por esta vez.
    }
    setOculta(true);
  };
  return (
    <div className="flex items-start gap-3 rounded-xl border border-brand-300 bg-brand-50 px-4 py-3 text-sm text-gray-800" role="note" data-testid={`pista-${id}`}>
      <Lightbulb size={18} aria-hidden="true" className="text-brand-700 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0 leading-relaxed">{children}</div>
      <button type="button" onClick={cerrar} aria-label="Entendido, ocultar esta pista" className="p-1 -m-1 text-gray-500 hover:text-gray-900 rounded">
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
