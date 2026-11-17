/**
 * Calculadora de precios: `/calculadora`, pública.
 *
 * Para el dueño que está empezando y no sabe cuánto cobrar: pone lo que compra,
 * cuánto le paga al lavador y sus gastos fijos, elige su ganancia —con una
 * sugerida— y ve el precio y en qué se va cada peso.
 *
 * Es pública a propósito: sirve dentro del panel (Configuración → Servicios la
 * enlaza) y sirve para que un dueño que todavía no usa Qlarity la encuentre.
 * Lo que escribe se guarda sólo en su navegador. La cuenta y el origen de los
 * valores iniciales están en lib/calculadora.ts.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import MarcaQ from '../components/MarcaQ';
import {
  calcular,
  GANANCIA_RANGO,
  GANANCIA_SUGERIDA,
  VALORES_INICIALES,
  type Entradas,
} from '../lib/calculadora';

const CLAVE = 'qlarity:calculadora';

const pesos = (v: number) => '$' + Math.round(v).toLocaleString('es-CO');

function leerGuardado(): Entradas {
  try {
    const crudo = localStorage.getItem(CLAVE);
    if (crudo) return { ...VALORES_INICIALES, ...(JSON.parse(crudo) as Partial<Entradas>) };
  } catch {
    // Navegador privado o sin almacenamiento: se arranca con los valores iniciales.
  }
  return VALORES_INICIALES;
}

const CAMPO =
  'w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-600 focus:border-transparent outline-none transition text-base text-gray-900';

export default function CalculadoraPage() {
  const [e, setE] = useState<Entradas>(leerGuardado);
  const r = useMemo(() => calcular(e), [e]);

  useEffect(() => {
    document.title = 'Calculadora de precios para lavaderos · Qlarity';
    try {
      localStorage.setItem(CLAVE, JSON.stringify(e));
    } catch {
      // Sin almacenamiento la calculadora igual funciona; sólo no recuerda.
    }
  }, [e]);

  const set = <K extends keyof Entradas>(k: K, v: Entradas[K]) => setE((x) => ({ ...x, [k]: v }));
  const num = (v: string) => (v === '' ? 0 : Number(v));
  const setInsumo = (i: number, cambio: Partial<Entradas['insumos'][number]>) =>
    set('insumos', e.insumos.map((x, j) => (j === i ? { ...x, ...cambio } : x)));

  const partes = r.precio
    ? [
        { nombre: 'Insumos', valor: r.insumos, color: 'bg-gray-400' },
        { nombre: 'Agua', valor: r.agua, color: 'bg-gray-300' },
        { nombre: 'Lavador', valor: r.lavador, color: 'bg-brand-400' },
        { nombre: 'Gastos fijos', valor: r.fijos, color: 'bg-gray-500' },
        { nombre: 'Tu ganancia', valor: r.ganancia, color: 'bg-green-600' },
      ]
    : [];

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 pb-40 lg:pb-8">
      <div className="max-w-5xl mx-auto">
        <Link to="/" className="inline-flex items-center gap-2.5 mb-8 text-gray-900">
          <MarcaQ size={22} className="text-brand-600" />
          <span className="text-sm font-semibold uppercase" style={{ fontStretch: '125%', letterSpacing: '0.18em' }}>
            Qlarity
          </span>
        </Link>
        <h1 className="text-2xl lg:text-3xl font-semibold text-gray-900">¿Cuánto cobrar por un lavado?</h1>
        <p className="text-gray-600 mt-2 max-w-2xl">
          Pon lo que te cuesta hacer el servicio y la ganancia que quieres. Los valores que ves son un ejemplo con precios
          comunes en Colombia: cámbialos por los tuyos.
        </p>

        <div className="mt-8 grid lg:grid-cols-[1fr_340px] gap-8 items-start">
          <div className="space-y-8">
            <Bloque titulo="Lo que gastas en productos" ayuda="Precio del envase y cuántos lavados te alcanza.">
              <div className="space-y-3">
                {e.insumos.map((ins, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_auto] sm:grid-cols-[1fr_130px_100px_auto] gap-2 items-end bg-white border border-gray-100 rounded-xl p-3">
                    <Campo etiqueta="Producto" id={`ins-nombre-${i}`} className="col-span-3 sm:col-span-1">
                      <input id={`ins-nombre-${i}`} className={CAMPO} value={ins.nombre} onChange={(v) => setInsumo(i, { nombre: v.target.value })} />
                    </Campo>
                    <Campo etiqueta="Precio ($)" id={`ins-precio-${i}`}>
                      <input id={`ins-precio-${i}`} className={CAMPO} type="number" inputMode="numeric" min={0} value={ins.precio || ''} onChange={(v) => setInsumo(i, { precio: num(v.target.value) })} />
                    </Campo>
                    <Campo etiqueta="Rinde" id={`ins-rinde-${i}`}>
                      <input id={`ins-rinde-${i}`} className={CAMPO} type="number" inputMode="numeric" min={0} value={ins.rinde || ''} onChange={(v) => setInsumo(i, { rinde: num(v.target.value) })} />
                    </Campo>
                    <button
                      type="button"
                      onClick={() => set('insumos', e.insumos.filter((_, j) => j !== i))}
                      aria-label={`Quitar ${ins.nombre || 'producto'}`}
                      className="p-2.5 text-gray-400 hover:text-red-700 rounded-lg hover:bg-gray-100 transition justify-self-end"
                    >
                      <Trash2 size={18} aria-hidden="true" />
                    </button>
                    <p className="col-span-3 sm:col-span-4 text-xs text-gray-500">
                      {ins.rinde > 0 ? `${pesos(ins.precio / ins.rinde)} por lavado` : 'Pon cuántos lavados rinde'}
                    </p>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => set('insumos', [...e.insumos, { nombre: '', precio: 0, rinde: 0 }])}
                  className="inline-flex items-center gap-2 text-sm font-semibold text-brand-700 hover:text-brand-800 px-1 py-2"
                >
                  <Plus size={16} aria-hidden="true" /> Agregar producto
                </button>
              </div>
            </Bloque>

            <Bloque titulo="Agua" ayuda="Un lavado completo gasta unos 100 a 150 litros: entre $800 y $1.500, según la tarifa de tu ciudad.">
              <Campo etiqueta="Agua por lavado ($)" id="agua">
                <input id="agua" className={`${CAMPO} max-w-[200px]`} type="number" inputMode="numeric" min={0} value={e.aguaPorLavado || ''} onChange={(v) => set('aguaPorLavado', num(v.target.value))} />
              </Campo>
            </Bloque>

            <Bloque titulo="Lo que le pagas al lavador" ayuda="Lo más común es un porcentaje de cada lavado: entre 25 % y 45 %.">
              <div className="flex gap-2 mb-3" role="radiogroup" aria-label="Cómo le pagas">
                <Opcion activa={e.pagoLavador === 'comision'} onClick={() => set('pagoLavador', 'comision')}>Porcentaje del lavado</Opcion>
                <Opcion activa={e.pagoLavador === 'fijo'} onClick={() => set('pagoLavador', 'fijo')}>Valor fijo por lavado</Opcion>
              </div>
              {e.pagoLavador === 'comision' ? (
                <Campo etiqueta="Porcentaje (%)" id="comision">
                  <input id="comision" className={`${CAMPO} max-w-[200px]`} type="number" inputMode="numeric" min={0} max={90} value={e.comisionPct || ''} onChange={(v) => set('comisionPct', num(v.target.value))} />
                </Campo>
              ) : (
                <Campo etiqueta="Pago por lavado ($)" id="pago-fijo">
                  <input id="pago-fijo" className={`${CAMPO} max-w-[200px]`} type="number" inputMode="numeric" min={0} value={e.pagoFijo || ''} onChange={(v) => set('pagoFijo', num(v.target.value))} />
                </Campo>
              )}
            </Bloque>

            <Bloque titulo="Gastos fijos del mes" ayuda="Lo que pagas haya o no haya carros. Se reparte entre los lavados que haces al mes.">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Campo etiqueta="Arriendo ($)" id="arriendo">
                  <input id="arriendo" className={CAMPO} type="number" inputMode="numeric" min={0} value={e.arriendo || ''} onChange={(v) => set('arriendo', num(v.target.value))} />
                </Campo>
                <Campo etiqueta="Luz y gas ($)" id="servicios">
                  <input id="servicios" className={CAMPO} type="number" inputMode="numeric" min={0} value={e.servicios || ''} onChange={(v) => set('servicios', num(v.target.value))} />
                </Campo>
                <Campo etiqueta="Otros ($)" id="otros">
                  <input id="otros" className={CAMPO} type="number" inputMode="numeric" min={0} value={e.otrosFijos || ''} onChange={(v) => set('otrosFijos', num(v.target.value))} />
                </Campo>
                <Campo etiqueta="Lavados al mes" id="lavados">
                  <input id="lavados" className={CAMPO} type="number" inputMode="numeric" min={0} value={e.lavadosAlMes || ''} onChange={(v) => set('lavadosAlMes', num(v.target.value))} />
                </Campo>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                {e.lavadosAlMes > 0 ? `${pesos(r.fijos)} por lavado` : 'Pon cuántos lavados haces al mes'} · 12 carros al día, 25 días, son 300.
              </p>
            </Bloque>

            <Bloque
              titulo="Tu ganancia"
              ayuda={`Lo que te queda de cada lavado después de pagar todo. Te sugerimos ${GANANCIA_SUGERIDA} %: los lavaderos suelen moverse entre ${GANANCIA_RANGO[0]} % y ${GANANCIA_RANGO[1]} %.`}
            >
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min={0}
                  max={60}
                  step={1}
                  value={e.gananciaPct}
                  onChange={(v) => set('gananciaPct', num(v.target.value))}
                  aria-label="Porcentaje de ganancia"
                  className="flex-1 accent-[rgb(var(--brand-600))]"
                />
                <span className="font-mono text-lg text-gray-900 w-14 text-right" aria-live="polite">{e.gananciaPct} %</span>
              </div>
              {e.gananciaPct !== GANANCIA_SUGERIDA && (
                <button type="button" onClick={() => set('gananciaPct', GANANCIA_SUGERIDA)} className="text-sm font-semibold text-brand-700 hover:text-brand-800 mt-2">
                  Usar la sugerida ({GANANCIA_SUGERIDA} %)
                </button>
              )}
              {(e.gananciaPct < GANANCIA_RANGO[0] || e.gananciaPct > GANANCIA_RANGO[1]) && (
                <p className="text-xs text-gray-600 mt-2">
                  {e.gananciaPct < GANANCIA_RANGO[0]
                    ? 'Con tan poca ganancia, un mes flojo o un daño te deja en pérdida.'
                    : 'Con tanta ganancia, revisa que el precio no quede muy por encima de los lavaderos de tu zona.'}
                </p>
              )}
            </Bloque>

            {/* En el celular el resultado fijo de abajo sólo cabe el precio: el
                desglose va acá, al final del formulario. */}
            {r.precio && (
              <section className="lg:hidden bg-white border border-gray-100 rounded-xl p-4">
                <h2 className="text-base font-semibold text-gray-900 mb-3">En qué se va cada lavado</h2>
                <dl className="space-y-2 text-sm">
                  {partes.map((p) => (
                    <div key={p.nombre} className="flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-sm ${p.color}`} aria-hidden="true" />
                      <dt className="text-gray-600 flex-1">{p.nombre}</dt>
                      <dd className="font-mono text-gray-900">{pesos(p.valor)}</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-xs text-gray-500 mt-4 leading-relaxed">
                  Como referencia, en Bogotá un lavado básico va de $15.000 a $25.000 y uno completo de $25.000 a $45.000.
                </p>
              </section>
            )}

            <button
              type="button"
              onClick={() => setE(VALORES_INICIALES)}
              className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
            >
              <RotateCcw size={15} aria-hidden="true" /> Volver a los valores de ejemplo
            </button>
          </div>

          {/* Resultado: abajo y fijo en el celular, al lado en escritorio. */}
          <aside
            aria-label="Resultado"
            className="fixed lg:sticky bottom-0 left-0 right-0 lg:top-8 z-20 bg-white border-t lg:border border-gray-100 lg:rounded-xl p-4 lg:p-5 shadow-2xl shadow-sombra lg:shadow-none"
          >
            <p className="etiqueta text-gray-500">Cobra al menos</p>
            {r.precioRedondeado ? (
              <>
                <p className="font-mono text-3xl lg:text-4xl font-semibold text-gray-900 mt-1" data-testid="precio">
                  {pesos(r.precioRedondeado)}
                </p>
                <p className="text-xs text-gray-500 mt-1">Tu ganancia: {pesos(r.ganancia)} por lavado</p>
                <div className="hidden lg:block mt-5">
                  <div className="flex h-2.5 rounded-full overflow-hidden" aria-hidden="true">
                    {partes.map((p) => (
                      <div key={p.nombre} className={p.color} style={{ width: `${(p.valor / (r.precio ?? 1)) * 100}%` }} />
                    ))}
                  </div>
                  <dl className="mt-4 space-y-2 text-sm">
                    {partes.map((p) => (
                      <div key={p.nombre} className="flex items-center gap-2">
                        <span className={`w-2.5 h-2.5 rounded-sm ${p.color}`} aria-hidden="true" />
                        <dt className="text-gray-600 flex-1">{p.nombre}</dt>
                        <dd className="font-mono text-gray-900">{pesos(p.valor)}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="text-xs text-gray-500 mt-5 leading-relaxed">
                    Como referencia, en Bogotá un lavado básico va de $15.000 a $25.000 y uno completo de $25.000 a $45.000.
                  </p>
                </div>
              </>
            ) : (
              <p className="text-sm text-red-800 mt-2" role="alert">
                La comisión y la ganancia se llevan todo el precio. Baja alguna de las dos.
              </p>
            )}
          </aside>
        </div>

        <section className="mt-14 border-t border-gray-100 pt-8 max-w-2xl">
          <h2 className="text-lg font-semibold text-gray-900">¿Tienes un lavadero?</h2>
          <p className="text-gray-600 mt-2">
            Con Qlarity llevas la agenda, el tablero de lavado, los pagos y el historial de cada carro, y tus clientes reservan
            solos desde su celular.
          </p>
          <Link to="/signup" className="inline-block mt-4 bg-brand-600 hover:bg-brand-700 text-white font-semibold text-sm px-5 py-3 rounded-lg transition">
            Probar gratis 14 días
          </Link>
        </section>
      </div>
    </div>
  );
}

function Bloque({ titulo, ayuda, children }: { titulo: string; ayuda: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-semibold text-gray-900">{titulo}</h2>
      <p className="text-sm text-gray-600 mt-1 mb-3">{ayuda}</p>
      {children}
    </section>
  );
}

function Campo({ etiqueta, id, className = '', children }: { etiqueta: string; id: string; className?: string; children: ReactNode }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-xs text-gray-500 mb-1">{etiqueta}</label>
      {children}
    </div>
  );
}

function Opcion({ activa, onClick, children }: { activa: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={activa}
      onClick={onClick}
      className={`px-3 py-2 rounded-lg border text-sm font-medium transition ${
        activa ? 'border-brand-600 bg-brand-600 text-white' : 'border-gray-200 bg-white text-gray-800 hover:border-gray-300'
      }`}
    >
      {children}
    </button>
  );
}
