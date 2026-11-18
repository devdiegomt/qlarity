import { ventasTiquetera } from '../fidelizacion/tiquetera';
import type { Request, Response } from 'express';
import * as db from '../../shared/db';
import { getTenantToday } from '../../shared/utils/dateUtils';

// ─── Helper: rango de fechas según period ────────────────────────────────────

interface DateRange { from: string; to: string; }

async function getDateRange(
  tenantId: string,
  period: string | undefined,
  from: string | undefined,
  to: string | undefined,
): Promise<DateRange> {
  const todayDate = await getTenantToday(tenantId);

  if (period === 'today') return { from: todayDate, to: todayDate };

  if (period === 'week') {
    const d = new Date(); d.setDate(d.getDate() - 6);
    return { from: d.toISOString().split('T')[0], to: todayDate };
  }

  if (period === 'month') {
    const d = new Date(); d.setDate(d.getDate() - 29);
    return { from: d.toISOString().split('T')[0], to: todayDate };
  }

  if (from && to) return { from, to };

  // Default: últimos 7 días
  const d = new Date(); d.setDate(d.getDate() - 6);
  return { from: d.toISOString().split('T')[0], to: todayDate };
}

// ─── GET /api/reports/dashboard ───────────────────────────────────────────────

export async function dashboard(req: Request, res: Response): Promise<void> {
  const q = req.query as Record<string, string | undefined>;
  const { from, to } = await getDateRange(req.tenantId!, q.period, q.from, q.to);

  type SummaryRow = {
    total_appointments: string; completed: string; cancelled: string;
    unique_customers: string; unique_vehicles: string; total_revenue: string;
    total_payments: string; avg_service_minutes: string | null; avg_ticket: string | null;
  };
  type PrevRow = { completed: string; total_revenue: string };

  const [{ rows }, prevResult] = await Promise.all([
    db.query<SummaryRow>(
      `SELECT
         COUNT(*) AS total_appointments,
         COUNT(*) FILTER (WHERE a.status = 'delivered') AS completed,
         COUNT(*) FILTER (WHERE a.status = 'cancelled') AS cancelled,
         COUNT(DISTINCT a.customer_id) AS unique_customers,
         COUNT(DISTINCT a.vehicle_id) AS unique_vehicles,
         COALESCE(SUM(p.amount), 0) AS total_revenue,
         COUNT(p.id) AS total_payments,
         AVG(EXTRACT(EPOCH FROM (a.completed_at - a.started_at)) / 60)
           FILTER (WHERE a.completed_at IS NOT NULL AND a.started_at IS NOT NULL) AS avg_service_minutes,
         AVG(p.amount) FILTER (WHERE p.amount > 0) AS avg_ticket
       FROM appointments a
       LEFT JOIN payments p ON p.appointment_id = a.id
       WHERE a.tenant_id = $1 AND a.scheduled_date BETWEEN $2 AND $3`,
      [req.tenantId, from, to],
    ),
    (async () => {
      const rangeDays = Math.ceil((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000) + 1;
      const prevTo   = new Date(from); prevTo.setDate(prevTo.getDate() - 1);
      const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - rangeDays + 1);
      return db.query<PrevRow>(
        `SELECT COUNT(*) FILTER (WHERE a.status = 'delivered') AS completed,
                COALESCE(SUM(p.amount), 0) AS total_revenue
         FROM appointments a
         LEFT JOIN payments p ON p.appointment_id = a.id
         WHERE a.tenant_id = $1 AND a.scheduled_date BETWEEN $2 AND $3`,
        [req.tenantId, prevFrom.toISOString().split('T')[0], prevTo.toISOString().split('T')[0]],
      );
    })(),
  ]);

  const r = rows[0];
  const prev = prevResult.rows[0];

  // Las tiqueteras entran a los ingresos el día que se venden, no cuando se
  // usan (cada uso es un pago de $0 más los adicionales).
  const rangeDays = Math.ceil((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000) + 1;
  const prevHasta = new Date(from); prevHasta.setDate(prevHasta.getDate() - 1);
  const prevDesde = new Date(prevHasta); prevDesde.setDate(prevDesde.getDate() - rangeDays + 1);
  const suma = (l: Array<{ total: number }>) => l.reduce((t, v) => t + v.total, 0);
  const tiqueteras = suma(await ventasTiquetera(req.tenantId!, from, to));
  const tiqueterasPrev = suma(await ventasTiquetera(
    req.tenantId!, prevDesde.toISOString().split('T')[0], prevHasta.toISOString().split('T')[0],
  ));

  const prevRevenue = parseInt(prev.total_revenue, 10) + tiqueterasPrev;
  const curRevenue  = parseInt(r.total_revenue, 10) + tiqueteras;
  const prevComp    = parseInt(prev.completed, 10);
  const curComp     = parseInt(r.completed, 10);

  res.json({
    period: { from, to },
    summary: {
      total_appointments:  parseInt(r.total_appointments, 10),
      completed:           curComp,
      cancelled:           parseInt(r.cancelled, 10),
      unique_customers:    parseInt(r.unique_customers, 10),
      unique_vehicles:     parseInt(r.unique_vehicles, 10),
      total_revenue:       curRevenue,
      tiquetera_revenue:   tiqueteras,
      total_payments:      parseInt(r.total_payments, 10),
      avg_service_minutes: r.avg_service_minutes ? Math.round(parseFloat(r.avg_service_minutes)) : null,
      avg_ticket:          r.avg_ticket ? parseInt(r.avg_ticket, 10) : 0,
    },
    comparison: {
      revenue_change_pct:     prevRevenue > 0 ? Math.round((curRevenue - prevRevenue) / prevRevenue * 100) : null,
      appointment_change_pct: prevComp    > 0 ? Math.round((curComp    - prevComp)    / prevComp    * 100) : null,
    },
  });
}

// ─── GET /api/reports/revenue ─────────────────────────────────────────────────

export async function revenue(req: Request, res: Response): Promise<void> {
  const q = req.query as Record<string, string | undefined>;
  const { from, to } = await getDateRange(req.tenantId!, q.period, q.from, q.to);

  type DailyRow  = { date: string | Date; completed: string; total: string; revenue: string };
  type MethodRow = { payment_method: string; count: string; total: string };
  type HourRow   = { hour: string; count: string };

  const [{ rows: daily }, { rows: byMethod }, { rows: byHour }] = await Promise.all([
    db.query<DailyRow>(
      `SELECT a.scheduled_date AS date,
              COUNT(*) FILTER (WHERE a.status = 'delivered') AS completed,
              COUNT(*) AS total,
              COALESCE(SUM(p.amount), 0) AS revenue
       FROM appointments a
       LEFT JOIN payments p ON p.appointment_id = a.id
       WHERE a.tenant_id = $1 AND a.scheduled_date BETWEEN $2 AND $3
       GROUP BY a.scheduled_date ORDER BY a.scheduled_date`,
      [req.tenantId, from, to],
    ),
    db.query<MethodRow>(
      `SELECT p.payment_method, COUNT(*) AS count, SUM(p.amount) AS total
       FROM payments p
       JOIN appointments a ON a.id = p.appointment_id
       WHERE a.tenant_id = $1 AND a.scheduled_date BETWEEN $2 AND $3
       GROUP BY p.payment_method ORDER BY total DESC`,
      [req.tenantId, from, to],
    ),
    db.query<HourRow>(
      `SELECT EXTRACT(HOUR FROM a.scheduled_time) AS hour, COUNT(*) AS count
       FROM appointments a
       WHERE a.tenant_id = $1 AND a.scheduled_date BETWEEN $2 AND $3
         AND a.scheduled_time IS NOT NULL AND a.status != 'cancelled'
       GROUP BY hour ORDER BY hour`,
      [req.tenantId, from, to],
    ),
  ]);

  // Ventas de tiqueteras: suman al ingreso del día de la venta y a su método.
  const ventas = await ventasTiquetera(req.tenantId!, from, to);
  // pg devuelve DATE como Date a medianoche local: se lee en local, no en UTC.
  const aFecha = (d: string | Date) =>
    d instanceof Date
      ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      : String(d).slice(0, 10);
  const diario = daily.map((r) => {
    const fecha = aFecha(r.date);
    const extra = ventas.filter((v) => v.dia === fecha).reduce((t, v) => t + v.total, 0);
    return { date: r.date, completed: parseInt(r.completed, 10), total: parseInt(r.total, 10), revenue: parseInt(r.revenue, 10) + extra };
  });
  for (const v of ventas) {
    if (!diario.some((d) => aFecha(d.date) === v.dia)) {
      diario.push({ date: v.dia, completed: 0, total: 0, revenue: v.total });
    }
  }
  diario.sort((a, b) => aFecha(a.date).localeCompare(aFecha(b.date)));
  const metodos = byMethod.map((r) => ({ method: r.payment_method, count: parseInt(r.count, 10), total: parseInt(r.total, 10) }));
  for (const v of ventas) {
    const m = metodos.find((x) => x.method === v.metodo);
    if (m) { m.total += v.total; m.count += v.n; } else metodos.push({ method: v.metodo, count: v.n, total: v.total });
  }

  res.json({
    period: { from, to },
    daily:    diario,
    byMethod: metodos.sort((a, b) => b.total - a.total),
    byHour:   byHour.map((r) => ({ hour: parseInt(r.hour, 10), count: parseInt(r.count, 10) })),
  });
}

// ─── GET /api/reports/services ────────────────────────────────────────────────

export async function topServices(req: Request, res: Response): Promise<void> {
  const q = req.query as Record<string, string | undefined>;
  const { from, to } = await getDateRange(req.tenantId!, q.period, q.from, q.to);

  type ServiceRow = { name: string; count: string; revenue: string; avg_minutes: string | null };

  const { rows } = await db.query<ServiceRow>(
    `SELECT s.name, COUNT(*) AS count,
            COALESCE(SUM(p.amount), 0) AS revenue,
            AVG(EXTRACT(EPOCH FROM (a.completed_at - a.started_at)) / 60)
              FILTER (WHERE a.completed_at IS NOT NULL AND a.started_at IS NOT NULL) AS avg_minutes
     FROM appointments a
     JOIN services s ON s.id = a.service_id
     LEFT JOIN payments p ON p.appointment_id = a.id
     WHERE a.tenant_id = $1 AND a.scheduled_date BETWEEN $2 AND $3 AND a.status != 'cancelled'
     GROUP BY s.name ORDER BY count DESC`,
    [req.tenantId, from, to],
  );

  res.json({
    period: { from, to },
    services: rows.map((r) => ({
      name: r.name,
      count: parseInt(r.count, 10),
      revenue: parseInt(r.revenue, 10),
      avg_minutes: r.avg_minutes ? Math.round(parseFloat(r.avg_minutes)) : null,
    })),
  });
}

// ─── GET /api/reports/customers ───────────────────────────────────────────────

export async function topCustomers(req: Request, res: Response): Promise<void> {
  const q = req.query as Record<string, string | undefined>;
  const { from, to } = await getDateRange(req.tenantId!, q.period, q.from, q.to);

  type CustRow = { id: string; first_name: string; last_name: string | null; phone: string; visit_count: string; total_spent: string; last_visit: string };

  const { rows } = await db.query<CustRow>(
    `SELECT c.id, c.first_name, c.last_name, c.phone,
            COUNT(a.id) AS visit_count, COALESCE(SUM(p.amount), 0) AS total_spent, MAX(a.scheduled_date) AS last_visit
     FROM appointments a
     JOIN customers c ON c.id = a.customer_id
     LEFT JOIN payments p ON p.appointment_id = a.id
     WHERE a.tenant_id = $1 AND a.scheduled_date BETWEEN $2 AND $3 AND a.status = 'delivered'
     GROUP BY c.id, c.first_name, c.last_name, c.phone
     ORDER BY total_spent DESC LIMIT 10`,
    [req.tenantId, from, to],
  );

  res.json({
    period: { from, to },
    customers: rows.map((r) => ({
      id: r.id, first_name: r.first_name, last_name: r.last_name, phone: r.phone,
      visit_count: parseInt(r.visit_count, 10),
      total_spent: parseInt(r.total_spent, 10),
      last_visit: r.last_visit,
    })),
  });
}

// ─── GET /api/reports/operators ───────────────────────────────────────────────

export async function operators(req: Request, res: Response): Promise<void> {
  const q = req.query as Record<string, string | undefined>;
  const { from, to } = await getDateRange(req.tenantId!, q.period, q.from, q.to);

  type OpRow = { id: string; first_name: string; last_name: string | null; total_appointments: string; completed: string; revenue_generated: string; avg_minutes: string | null };

  const { rows } = await db.query<OpRow>(
    `SELECT u.id, u.first_name, u.last_name,
            COUNT(a.id) AS total_appointments,
            COUNT(a.id) FILTER (WHERE a.status = 'delivered') AS completed,
            COALESCE(SUM(p.amount), 0) AS revenue_generated,
            AVG(EXTRACT(EPOCH FROM (a.completed_at - a.started_at)) / 60)
              FILTER (WHERE a.completed_at IS NOT NULL AND a.started_at IS NOT NULL) AS avg_minutes
     FROM users u
     LEFT JOIN appointments a ON a.assigned_to = u.id AND a.scheduled_date BETWEEN $2 AND $3
     LEFT JOIN payments p ON p.appointment_id = a.id
     WHERE u.tenant_id = $1 AND u.role = 'operator' AND u.is_active = true
     GROUP BY u.id, u.first_name, u.last_name
     ORDER BY completed DESC`,
    [req.tenantId, from, to],
  );

  res.json({
    period: { from, to },
    operators: rows.map((r) => ({
      id: r.id, first_name: r.first_name, last_name: r.last_name,
      total: parseInt(r.total_appointments, 10),
      completed: parseInt(r.completed, 10),
      revenue: parseInt(r.revenue_generated, 10),
      avg_minutes: r.avg_minutes ? Math.round(parseFloat(r.avg_minutes)) : null,
    })),
  });
}