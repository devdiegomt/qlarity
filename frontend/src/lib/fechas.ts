/**
 * Fechas «de calendario» (YYYY-MM-DD) en la hora del celular, no en UTC.
 *
 * `new Date().toISOString().split('T')[0]` da la fecha **en UTC**. En Colombia
 * (UTC−5), de las 7 p. m. a medianoche eso ya es el día siguiente: la Agenda
 * abría en mañana y «Pagos de hoy» mostraba otro día. Lo vio el primer
 * lavadero, de noche, buscando las reservas web de ese día.
 *
 * `en-CA` formatea como YYYY-MM-DD, en la zona del dispositivo.
 */
export function fechaLocal(d: Date = new Date()): string {
  return d.toLocaleDateString('en-CA');
}

/** La fecha `fecha` (YYYY-MM-DD) más `dias` días de calendario. */
export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return fechaLocal(d);
}

/** «Hoy», «Mañana» o «lunes 18 de noviembre». */
export function etiquetaDia(fecha: string, hoy: string = fechaLocal()): string {
  if (fecha === hoy) return 'Hoy';
  if (fecha === sumarDias(hoy, 1)) return 'Mañana';
  return new Date(`${fecha}T12:00:00`).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
}

/** La parte de fecha de lo que devuelve la API (`2026-11-16T00:00:00.000Z` o `2026-11-16`). */
export function soloFecha(valor: string): string {
  return valor.slice(0, 10);
}

interface TurnoConTiempos {
  status: string;
  started_at: string | null;
  created_at: string;
  scheduled_date?: string | null;
  scheduled_time?: string | null;
}

/**
 * Desde cuándo se cuenta lo que lleva un turno en su estado.
 *
 * Lavando: desde que empezó. Esperando: desde la hora agendada si la tiene
 * —y nada si esa hora todavía no llega—; si no, desde que se creó. Antes
 * «esperando» contaba siempre desde la creación, y una reserva web hecha hace
 * dos días salía en naranja con «48h 0m», como si el cliente llevara dos días
 * esperando.
 */
export function inicioDeEspera(t: TurnoConTiempos, ahora: Date = new Date()): Date | null {
  if (t.status === 'in_progress') return t.started_at ? new Date(t.started_at) : null;
  if (t.status !== 'pending') return null;
  if (t.scheduled_date && t.scheduled_time) {
    const agendado = new Date(`${soloFecha(t.scheduled_date)}T${t.scheduled_time.slice(0, 5)}:00`);
    return agendado.getTime() > ahora.getTime() ? null : agendado;
  }
  return new Date(t.created_at);
}

/** «2027-02-16» → «16 feb 2027». */
export function fechaCorta(fecha: string): string {
  return new Date(`${fecha.slice(0, 10)}T12:00:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
}
