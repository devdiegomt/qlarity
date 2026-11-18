/**
 * Fotos de cómo llegó el vehículo, en el detalle del turno.
 *
 * El operario las toma con la cámara del celular al recibir el carro: si
 * después el cliente reclama por un rayón que ya estaba, el lavadero tiene con
 * qué mostrarlo. Se achican en el teléfono antes de subirlas (ver
 * lib/imagenes.ts) y se borran solas a los 90 días, salvo que el turno tenga
 * un reclamo abierto.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, ShieldAlert, Trash2 } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { achicarFoto } from '../lib/imagenes';
import { useAuth } from '../hooks/useAuth';
import { useToast } from './ui';

interface Foto {
  id: string;
  url: string;
  creadaEn: string;
  tomadaPor: string | null;
  propia: boolean;
}

interface Props {
  appointmentId: string;
  reclamoAbiertoEn: string | null;
  reclamoNota: string | null;
}

export default function FotosRecepcion({ appointmentId, reclamoAbiertoEn, reclamoNota }: Props) {
  const toast = useToast();
  const { user } = useAuth();
  const esAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const [fotos, setFotos] = useState<Foto[] | null>(null);
  const [sinConfigurar, setSinConfigurar] = useState(false);
  const [subiendo, setSubiendo] = useState<string | null>(null);
  const [ampliada, setAmpliada] = useState<Foto | null>(null);
  const [reclamo, setReclamo] = useState({ abierto: Boolean(reclamoAbiertoEn), nota: reclamoNota ?? '' });
  const [editandoReclamo, setEditandoReclamo] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  const cargar = useCallback(() => {
    api<Foto[]>(`/appointments/${appointmentId}/fotos`)
      .then(setFotos)
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 503) setSinConfigurar(true);
        setFotos([]);
      });
  }, [appointmentId]);

  useEffect(cargar, [cargar]);

  const alElegir = async (archivos: FileList | null) => {
    if (!archivos || archivos.length === 0) return;
    const lista = Array.from(archivos);
    for (let i = 0; i < lista.length; i++) {
      setSubiendo(lista.length > 1 ? `Subiendo ${i + 1} de ${lista.length}…` : 'Subiendo…');
      try {
        const blob = await achicarFoto(lista[i]);
        await api(`/appointments/${appointmentId}/fotos`, { method: 'POST', body: blob });
      } catch (e) {
        toast.error((e as Error).message);
        break;
      }
    }
    setSubiendo(null);
    if (entrada.current) entrada.current.value = '';
    cargar();
  };

  const borrar = async (f: Foto) => {
    if (!window.confirm('¿Borrar esta foto?')) return;
    try {
      await api(`/appointments/${appointmentId}/fotos/${f.id}`, { method: 'DELETE' });
      setAmpliada(null);
      cargar();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const guardarReclamo = async (abierto: boolean) => {
    try {
      const r = await api<{ reclamoAbiertoEn: string | null; reclamoNota: string | null }>(
        `/appointments/${appointmentId}/reclamo`,
        { method: 'PATCH', body: { abierto, nota: reclamo.nota.trim() || null } },
      );
      setReclamo({ abierto: Boolean(r.reclamoAbiertoEn), nota: r.reclamoNota ?? '' });
      setEditandoReclamo(false);
      toast.success(abierto ? 'Reclamo abierto: las fotos no se borran' : 'Reclamo cerrado');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (sinConfigurar) {
    return <p className="text-sm text-gray-500">Las fotos todavía no están activadas en este servidor.</p>;
  }

  return (
    <div className="space-y-3">
      {fotos === null ? (
        <p className="text-sm text-gray-500">Cargando fotos…</p>
      ) : fotos.length === 0 ? (
        <p className="text-sm text-gray-500">Todavía no hay fotos de cómo llegó el vehículo.</p>
      ) : (
        <ul className="grid grid-cols-3 gap-2" aria-label="Fotos de recepción">
          {fotos.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => setAmpliada(f)}
                className="block w-full aspect-square overflow-hidden rounded-lg border border-gray-100 bg-gray-50"
                aria-label={`Ver foto${f.tomadaPor ? ` tomada por ${f.tomadaPor}` : ''}`}
              >
                <img src={f.url} alt="" loading="lazy" className="w-full h-full object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        ref={entrada}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        data-testid="entrada-fotos"
        onChange={(e) => void alElegir(e.target.files)}
      />
      <button
        type="button"
        onClick={() => entrada.current?.click()}
        disabled={subiendo !== null}
        className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg border border-brand-400 text-brand-800 text-sm font-semibold hover:bg-brand-50 transition disabled:opacity-60"
      >
        <Camera size={16} aria-hidden="true" />
        {subiendo ?? 'Tomar fotos'}
      </button>
      <p className="text-xs text-gray-500">
        Para el estado del vehículo al recibirlo. Se borran solas a los 90 días, salvo que el turno tenga un reclamo
        abierto.
      </p>

      {/* Reclamo */}
      <div className={`rounded-lg border p-3 ${reclamo.abierto ? 'border-orange-600/60 bg-orange-50' : 'border-gray-100'}`}>
        {reclamo.abierto && !editandoReclamo ? (
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-semibold text-orange-800">
              <ShieldAlert size={16} aria-hidden="true" /> Reclamo abierto
            </p>
            {reclamo.nota && <p className="text-sm text-gray-700">{reclamo.nota}</p>}
            <p className="text-xs text-gray-600">Mientras esté abierto, las fotos de este turno no se borran.</p>
            <button type="button" onClick={() => void guardarReclamo(false)} className="text-sm font-semibold text-brand-700 hover:text-brand-800">
              Cerrar reclamo
            </button>
          </div>
        ) : editandoReclamo ? (
          <div className="space-y-2">
            <label htmlFor="nota-reclamo" className="block text-sm font-semibold text-gray-900">¿Qué reclama el cliente?</label>
            <textarea
              id="nota-reclamo"
              value={reclamo.nota}
              onChange={(e) => setReclamo((r) => ({ ...r, nota: e.target.value }))}
              rows={2}
              maxLength={500}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:ring-2 focus:ring-brand-500 outline-none"
            />
            <div className="flex gap-2">
              <button type="button" onClick={() => void guardarReclamo(true)} className="text-sm font-semibold px-3 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700">
                Abrir reclamo
              </button>
              <button type="button" onClick={() => setEditandoReclamo(false)} className="text-sm px-3 py-2 text-gray-600">
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setEditandoReclamo(true)} className="flex items-center gap-2 text-sm text-gray-700 hover:text-gray-900">
            <ShieldAlert size={16} aria-hidden="true" className="text-gray-500" /> El cliente reclama por un daño
          </button>
        )}
      </div>

      {/* Foto ampliada */}
      {ampliada && (
        <div className="fixed inset-0 z-[60] bg-black/90 flex flex-col" role="dialog" aria-label="Foto ampliada" onClick={() => setAmpliada(null)}>
          <img src={ampliada.url} alt="" className="flex-1 min-h-0 object-contain p-4" />
          <div className="flex items-center justify-between gap-3 px-4 pb-6 text-sm text-white/80" onClick={(e) => e.stopPropagation()}>
            <span>
              {new Date(ampliada.creadaEn).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}
              {ampliada.tomadaPor ? ` · ${ampliada.tomadaPor}` : ''}
            </span>
            <span className="flex gap-2">
              {(esAdmin || ampliada.propia) && !reclamo.abierto && (
                <button type="button" onClick={() => void borrar(ampliada)} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20">
                  <Trash2 size={15} aria-hidden="true" /> Borrar
                </button>
              )}
              <button type="button" onClick={() => setAmpliada(null)} className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20">
                Cerrar
              </button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
