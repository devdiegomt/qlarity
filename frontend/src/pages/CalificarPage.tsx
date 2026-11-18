/**
 * La encuesta del cliente: `/calificar/:token`.
 *
 * Le llega por WhatsApp al entregar el carro. Estrellas de 1 a 5, un
 * comentario opcional, y después el botón para dejar su reseña en Google —para
 * todos, sin importar cuántas estrellas puso: Google prohíbe filtrar quién
 * llega a dejar reseña—. Ver src/modules/resenas/resenas.ts.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { Check, Star } from 'lucide-react';
import MarcaQ from '../components/MarcaQ';
import { api } from '../lib/api';

interface Encuesta {
  lavadero: string;
  servicio: string;
  fecha: string;
  respondida: boolean;
  estrellas: number | null;
  googleUrl: string | null;
}

const ETIQUETAS = ['', 'Muy mal', 'Mal', 'Regular', 'Bien', '¡Excelente!'];

export default function CalificarPage() {
  const { token = '' } = useParams();
  const base = `/publico/calificaciones/${encodeURIComponent(token)}`;
  const [e, setE] = useState<Encuesta | null>(null);
  const [noExiste, setNoExiste] = useState(false);
  const [estrellas, setEstrellas] = useState(0);
  const [comentario, setComentario] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Encuesta>(base)
      .then((x) => {
        setE(x);
        document.title = `Califica a ${x.lavadero}`;
      })
      .catch(() => setNoExiste(true));
  }, [base]);

  const enviar = async (ev: FormEvent) => {
    ev.preventDefault();
    if (estrellas === 0) {
      setError('Toca las estrellas para calificar.');
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      setE(await api<Encuesta>(base, { method: 'POST', body: { estrellas, comentario: comentario.trim() || null } }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  const irAGoogle = () => {
    void api(`${base}/google`, { method: 'POST' }).catch(() => undefined);
  };

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <main className="max-w-md mx-auto">
        {noExiste ? (
          <>
            <h1 className="text-2xl font-semibold text-gray-900">No encontramos esta encuesta</h1>
            <p className="text-gray-600 mt-3">Revisa el enlace que te llegó por WhatsApp.</p>
          </>
        ) : !e ? (
          <div aria-busy="true" />
        ) : e.respondida ? (
          <>
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-green-100 text-green-700 mb-5">
              <Check size={26} aria-hidden="true" />
            </div>
            <h1 className="text-2xl font-semibold text-gray-900">¡Gracias por contarnos!</h1>
            <p className="text-gray-600 mt-2">Tu opinión le llega directo a {e.lavadero}.</p>
            {e.googleUrl && (
              <div className="mt-8 bg-white border border-gray-100 rounded-xl p-5">
                <p className="text-gray-900 font-semibold">¿Nos ayudas con una reseña en Google?</p>
                <p className="text-sm text-gray-600 mt-1">Así más personas pueden encontrar a {e.lavadero}. Toma un minuto.</p>
                <a
                  href={e.googleUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={irAGoogle}
                  className="mt-4 w-full inline-flex items-center justify-center py-3 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-lg transition"
                >
                  Dejar reseña en Google
                </a>
              </div>
            )}
          </>
        ) : (
          <form onSubmit={enviar} noValidate>
            <h1 className="text-2xl font-semibold text-gray-900">¿Cómo te fue en {e.lavadero}?</h1>
            <p className="text-gray-600 mt-2">
              {e.servicio} · {new Date(`${e.fecha}T12:00:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'long' })}
            </p>

            <div className="mt-8 flex justify-center gap-2" role="radiogroup" aria-label="Calificación">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={estrellas === n}
                  aria-label={`${n} ${n === 1 ? 'estrella' : 'estrellas'}`}
                  onClick={() => setEstrellas(n)}
                  className="p-1.5 text-brand-600 rounded-lg focus-visible:ring-2 focus-visible:ring-brand-600"
                >
                  <Star size={40} strokeWidth={1.5} fill={n <= estrellas ? 'currentColor' : 'none'} aria-hidden="true" />
                </button>
              ))}
            </div>
            <p className="text-center text-sm text-gray-700 h-5 mt-2" aria-live="polite">{ETIQUETAS[estrellas]}</p>

            <label htmlFor="comentario" className="block text-sm font-semibold text-gray-900 mt-8 mb-2">
              ¿Algo que quieras contarnos? <span className="font-normal text-gray-500">(opcional)</span>
            </label>
            <textarea
              id="comentario"
              value={comentario}
              onChange={(x) => setComentario(x.target.value)}
              rows={3}
              maxLength={1000}
              className="w-full px-4 py-3 bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-600 focus:border-transparent outline-none text-base text-gray-900"
            />

            {error && (
              <div role="alert" className="mt-4 bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3 rounded-lg">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={enviando}
              className="mt-6 w-full py-3.5 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-lg transition disabled:opacity-50"
            >
              {enviando ? 'Enviando…' : 'Enviar'}
            </button>
          </form>
        )}

        <footer className="mt-14 pt-6 border-t border-gray-100 flex items-center gap-2 text-xs text-gray-500">
          <MarcaQ size={14} className="text-brand-600" />
          Con Qlarity
        </footer>
      </main>
    </div>
  );
}
