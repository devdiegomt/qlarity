import { inicioDeEspera } from "../lib/fechas";
import EtiquetaWeb from "../components/EtiquetaWeb";
import FotosRecepcion from "../components/FotosRecepcion";
import { useProximas } from "../components/ProximasReservas";
import { Link } from "react-router-dom";
import { ESTADOS, PastillaEstado, Placa, PuntoEstado } from "../lib/estados";
import { Clock, RotateCw, X } from 'lucide-react';
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { api } from "../lib/api";
import { formatCOP, formatTime } from "../lib/format";
import { useToast, usePullToRefresh, ConfirmDialog } from "../components/ui";
import PaymentModal from "../components/PaymentModal";
import type { AppointmentStatus, VehicleType } from "../types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BoardAppointment {
  id: string;
  status: AppointmentStatus;
  plate: string;
  vehicle_type: VehicleType;
  brand: string | null;
  model: string | null;
  color: string | null;
  customer_first_name: string;
  customer_last_name: string | null;
  customer_phone: string;
  service_name: string;
  estimated_minutes: number;
  bay_number: number | null;
  assigned_to: string | null;
  scheduled_date: string;
  scheduled_time: string | null;
  started_at: string | null;
  created_at: string;
  price: number;
  total_amount?: number;
  notes: string | null;
  source: string;
  operator_first_name?: string | null;
  /** Servicios adicionales («encera tú mismo»), con precio en centavos. */
  adicionales?: Array<{ id: string; nombre: string; precio: number; minutos: number }>;
  minutos_adicionales?: number;
  /** Cuándo terminó el lavado y empezó el adicional. */
  adicional_iniciado_at?: string | null;
  reclamo_abierto_at?: string | null;
  reclamo_nota?: string | null;
}

/**
 * Qué toca hacer con el turno ahora. Con adicionales, «Lavando» tiene dos
 * pasos: primero el lavado y después el adicional (el cliente encera su carro
 * acompañado); el turno se marca listo al terminar el segundo.
 */
type Accion =
  | { tipo: "estado"; status: AppointmentStatus; label: string }
  | { tipo: "adicional"; label: string };

function accionSiguiente(a: BoardAppointment): Accion | null {
  const conAdicional = (a.adicionales?.length ?? 0) > 0;
  if (a.status === "in_progress" && conAdicional && !a.adicional_iniciado_at) {
    return { tipo: "adicional", label: `Lavado listo → ${a.adicionales!.map((x) => x.nombre).join(" y ")}` };
  }
  const status = NEXT_STATUS[a.status];
  const label = NEXT_LABEL[a.status];
  return status && label ? { tipo: "estado", status, label } : null;
}

/** El turno ya está en su adicional: el lavado terminó. */
const enAdicional = (a: BoardAppointment) => a.status === "in_progress" && Boolean(a.adicional_iniciado_at);

interface AppointmentDetail extends BoardAppointment {
  customer_email?: string | null;
  year?: number | null;
  status_log?: Array<{
    created_at: string;
    previous_status: string | null;
    new_status: string;
    first_name?: string | null;
  }>;
}

interface Operator {
  id: string;
  first_name: string;
  last_name: string | null;
}

interface Column {
  key: AppointmentStatus;
  label: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const COLUMNS: Column[] = [
  { key: "pending", label: "Esperando" },
  { key: "in_progress", label: "Lavando" },
  { key: "done", label: "Listo" },
  { key: "delivered", label: "Entregado" },
];

const NEXT_STATUS: Partial<Record<AppointmentStatus, AppointmentStatus>> = {
  pending: "in_progress",
  in_progress: "done",
  done: "delivered",
};

const NEXT_LABEL: Partial<Record<AppointmentStatus, string>> = {
  pending: "Iniciar",
  in_progress: "Listo",
  done: "Entregar",
};

// ─── BoardPage ────────────────────────────────────────────────────────────────

export default function BoardPage() {
  const [appointments, setAppointments] = useState<BoardAppointment[]>([]);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDelivered, setShowDelivered] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [paymentTarget, setPaymentTarget] = useState<BoardAppointment | null>(
    null,
  );
  const refreshInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const toast = useToast();

  const fetchData = useCallback(async () => {
    try {
      const data = await api<BoardAppointment[]>("/appointments/today");
      setAppointments(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Pull to refresh on mobile
  usePullToRefresh(fetchData);

  // Fetch operators once
  useEffect(() => {
    api<Operator[]>("/tenants/me/operators")
      .then(setOperators)
      .catch(() => setOperators([]));
  }, []);

  // Refresh data every 30 seconds (real-time-ish for a lavadero)
  useEffect(() => {
    fetchData();
    refreshInterval.current = setInterval(fetchData, 30_000);
    return () => {
      if (refreshInterval.current) clearInterval(refreshInterval.current);
    };
  }, [fetchData]);

  const handleStatusChange = async (
    id: string,
    newStatus: AppointmentStatus,
  ) => {
    // If moving to delivered, prompt for payment first
    if (newStatus === "delivered") {
      const apt = appointments.find((a) => a.id === id);
      if (apt) {
        setPaymentTarget(apt);
        return;
      }
    }

    // Optimistic update
    setAppointments((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: newStatus } : a)),
    );

    try {
      await api(`/appointments/${id}/status`, {
        method: "PATCH",
        body: { status: newStatus },
      });
      const labels: Partial<Record<AppointmentStatus, string>> = {
        in_progress: "Lavado iniciado",
        done: "Marcado como listo",
        cancelled: "Turno cancelado",
      };
      toast.success(labels[newStatus] ?? "Estado actualizado");
      fetchData(); // Re-fetch to get accurate timestamps
    } catch (err) {
      toast.error((err as Error).message);
      fetchData(); // Revert on error
    }
  };

  const handleAdicional = async (id: string) => {
    try {
      await api(`/appointments/${id}/adicional`, { method: "PATCH" });
      const apt = appointments.find((a) => a.id === id);
      toast.success(`Empieza: ${apt?.adicionales?.map((x) => x.nombre).join(" y ") ?? "el adicional"}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      fetchData();
    }
  };

  const handlePaymentComplete = async () => {
    if (!paymentTarget) return;
    // After payment registered, move to delivered
    try {
      await api(`/appointments/${paymentTarget.id}/status`, {
        method: "PATCH",
        body: { status: "delivered" },
      });
    } catch (err) {
      console.error("Error moving to delivered:", err);
    }
    setPaymentTarget(null);
    toast.success("Pago registrado y turno entregado");
    fetchData();
  };

  const handleAssign = async (appointmentId: string, operatorId: string) => {
    try {
      await api(`/appointments/${appointmentId}`, {
        method: "PATCH",
        body: { assignedTo: operatorId || null },
      });
      fetchData();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const columnsToShow = showDelivered
    ? COLUMNS
    : COLUMNS.filter((c) => c.key !== "delivered");
  const getColumnAppointments = (status: AppointmentStatus) =>
    appointments.filter((a) => a.status === status);
  const activeCount = appointments.filter(
    (a) => !["delivered", "cancelled"].includes(a.status),
  ).length;
  const deliveredCount = appointments.filter(
    (a) => a.status === "delivered",
  ).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Tablero</h1>
          <p className="text-sm text-gray-500">
            {activeCount} activos · {deliveredCount} entregados hoy
          </p>
          <AvisoProximas />
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={showDelivered}
              onChange={(e) => setShowDelivered(e.target.checked)}
              className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
            />
            Mostrar entregados
          </label>
          <button
            onClick={fetchData}
            className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded-lg border border-gray-200 hover:border-gray-300 transition"
            title="Actualizar"
          >
            <RotateCw aria-hidden="true" size={15} strokeWidth={1.8} />
            Actualizar
          </button>
        </div>
      </div>

      {/* Kanban board */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-white rounded-xl p-4 h-64 animate-pulse"
            />
          ))}
        </div>
      ) : (
        <>
          {/* Desktop: horizontal columns */}
          <div
            className="hidden md:grid gap-4"
            style={{
              gridTemplateColumns: `repeat(${columnsToShow.length}, minmax(0, 1fr))`,
            }}
          >
            {columnsToShow.map((col) => {
              const items = getColumnAppointments(col.key);
              return (
                <div key={col.key} className="min-h-[300px] min-w-0">
                  <div className="flex items-center gap-2 px-1 pb-3 mb-1 border-b border-gray-100">
                    <PuntoEstado status={col.key} />
                    <span className="etiqueta font-semibold text-gray-600">{col.label}</span>
                    <span className="ml-auto font-mono text-xs text-gray-800">{items.length}</span>
                  </div>
                  <div className="pt-2 space-y-2">
                    {items.length === 0 ? (
                      <p className="text-center text-xs text-gray-400 py-8">
                        Sin turnos
                      </p>
                    ) : (
                      items.map((a) => (
                        <KanbanCard
                          key={a.id}
                          appointment={a}
                          operators={operators}
                          onStatusChange={handleStatusChange}
                          onAdicional={handleAdicional}
                          onAssign={handleAssign}
                          onDetail={() => setDetailId(a.id)}
                          compact
                        />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Mobile: stacked sections */}
          <div className="md:hidden space-y-4">
            {columnsToShow.map((col) => {
              const items = getColumnAppointments(col.key);
              if (items.length === 0 && col.key === "delivered") return null;
              return (
                <div key={col.key}>
                  <div className="flex items-center gap-2 mb-2">
                    <PuntoEstado status={col.key} />
                    <h2 className="etiqueta font-semibold text-gray-600">{col.label}</h2>
                    <span className="ml-auto font-mono text-xs text-gray-800">{items.length}</span>
                  </div>
                  {items.length === 0 ? (
                    <p className="text-xs text-gray-400 pl-5 pb-2">
                      Sin turnos
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {items.map((a) => (
                        <KanbanCard
                          key={a.id}
                          appointment={a}
                          operators={operators}
                          onStatusChange={handleStatusChange}
                          onAdicional={handleAdicional}
                          onAssign={handleAssign}
                          onDetail={() => setDetailId(a.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Detail modal */}
      {detailId && (
        <DetailModal
          appointmentId={detailId}
          operators={operators}
          onClose={() => setDetailId(null)}
          onStatusChange={(id, s) => {
            handleStatusChange(id, s);
            setDetailId(null);
          }}
          onAdicional={(id) => {
            handleAdicional(id);
            setDetailId(null);
          }}
          onAssign={handleAssign}
        />
      )}

      {/* Payment modal — aparece al entregar */}
      {paymentTarget && (
        <PaymentModal
          appointment={paymentTarget}
          onClose={() => setPaymentTarget(null)}
          onSaved={handlePaymentComplete}
        />
      )}
    </div>
  );
}

// ─── Kanban Card ──────────────────────────────────────────────────────────────

interface KanbanCardProps {
  appointment: BoardAppointment;
  operators: Operator[];
  onStatusChange(id: string, status: AppointmentStatus): void;
  onAdicional(id: string): void;
  onAssign(id: string, operatorId: string): void;
  onDetail(): void;
  compact?: boolean;
}

function KanbanCard({
  appointment: a,
  operators,
  onStatusChange,
  onAdicional,
  onAssign,
  onDetail,
  compact,
}: KanbanCardProps) {
  const elapsed = getElapsedTime(a);
  const isOvertime = isOvertimeCheck(a);
  const accion = accionSiguiente(a);

  return (
    <div
      className={`bg-white rounded-lg border border-gray-100 border-l-[3px] ${ESTADOS[a.status].borde} p-3 hover:border-gray-300 transition cursor-pointer ${
        isOvertime ? "ring-1 ring-orange-600/60" : ""
      }`}
      onClick={onDetail}
    >
      {/* Top row: plate + elapsed */}
      <div className="flex items-center justify-between mb-1">
        <span className="flex items-center gap-1.5">
          <Placa placa={a.plate} />
          <EtiquetaWeb source={a.source} />
        </span>
        {elapsed && (a.status === "pending" || a.status === "in_progress") && (
          <span
            className={`font-mono text-xs tabular-nums ${
              isOvertime ? "text-orange-700 font-semibold" : "text-gray-500"
            }`}
            title={isOvertime ? "Lleva más tiempo del estimado" : undefined}
          >
            {elapsed}
          </span>
        )}
      </div>

      {/* Vehicle info */}
      <p className="text-xs text-gray-600 truncate mt-1.5">
        {a.brand} {a.model} {a.color ? `· ${a.color}` : ""}
      </p>

      {/* Service */}
      <p className="text-xs text-gray-500 mt-0.5">
        {a.service_name} · {formatCOP(a.price)}
      </p>
      {(a.adicionales?.length ?? 0) > 0 && (
        <p className="text-xs text-brand-800 mt-0.5">+ {a.adicionales!.map((x) => x.nombre).join(", ")}</p>
      )}
      {enAdicional(a) && (
        <p className="mt-1.5 text-xs font-semibold text-gray-900 bg-brand-50 border border-brand-300 rounded px-2 py-1">
          Lavado listo · {a.adicionales!.map((x) => x.nombre).join(" y ")}
          <span className="block font-normal text-gray-600">
            Acompaña: {a.operator_first_name ?? "sin asignar"}
          </span>
        </p>
      )}

      {/* Customer (full mode) */}
      {!compact && (
        <p className="text-xs text-gray-400 mt-0.5">
          {a.customer_first_name} {a.customer_last_name} · {a.customer_phone}
        </p>
      )}

      {/* Scheduled time */}
      {a.scheduled_time && (
        <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
          <Clock aria-hidden="true" size={12} strokeWidth={1.8} />
          {formatTime(a.scheduled_time)}
        </p>
      )}

      {/* Operator assignment */}
      {(a.status === "pending" || a.status === "in_progress") &&
        operators.length > 0 && (
          <div className="mt-2" onClick={(e) => e.stopPropagation()}>
            <select
              title="Asignar o cambiar el operador responsable de este turno"
              value={a.assigned_to ?? ""}
              onChange={(e) => onAssign(a.id, e.target.value)}
              className="w-full text-xs border border-gray-200 rounded-md px-2 py-1.5 bg-white focus:ring-1 focus:ring-brand-500 outline-none"
            >
              <option value="">Sin asignar</option>
              {operators.map((op) => (
                <option key={op.id} value={op.id}>
                  {op.first_name} {op.last_name ?? ""}
                </option>
              ))}
            </select>
          </div>
        )}

      {/* Bay number */}
      {a.bay_number && (
        <span className="inline-block mt-1.5 text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded font-medium">
          Bahía {a.bay_number}
        </span>
      )}

      {/* Action button */}
      {accion && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (accion.tipo === "adicional") onAdicional(a.id);
            else onStatusChange(a.id, accion.status);
          }}
          className="mt-3 w-full text-xs font-semibold py-2 rounded-lg border border-brand-400 text-brand-800 hover:bg-brand-600 hover:text-white hover:border-brand-600 transition"
        >
          {accion.label}
        </button>
      )}
    </div>
  );
}

// ─── Detail Modal ─────────────────────────────────────────────────────────────

interface DetailModalProps {
  appointmentId: string;
  operators: Operator[];
  onClose(): void;
  onStatusChange(id: string, status: AppointmentStatus): void;
  onAdicional(id: string): void;
  onAssign(id: string, operatorId: string): void;
}

function DetailModal({
  appointmentId,
  operators,
  onClose,
  onStatusChange,
  onAdicional,
  onAssign,
}: DetailModalProps) {
  const [data, setData] = useState<AppointmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmCancel, setConfirmCancel] = useState(false);

  useEffect(() => {
    api<AppointmentDetail>(`/appointments/${appointmentId}`)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [appointmentId]);

  if (loading || !data) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-black/40" onClick={onClose} />
        <div className="relative bg-white border border-gray-100 rounded-xl p-8" role="status" aria-label="Cargando">
          <div aria-hidden="true" className="w-7 h-7 border-2 border-gray-200 border-t-brand-600 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  const accion = accionSiguiente(data);
  const elapsed = getElapsedTime(data);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white border border-gray-100 w-full max-w-lg rounded-t-xl sm:rounded-xl max-h-[90vh] overflow-y-auto shadow-2xl shadow-sombra">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-center justify-between rounded-t-xl z-10">
          <div className="flex items-center gap-3">
            <Placa placa={data.plate} className="!text-lg" />
            <PastillaEstado status={data.status} />
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-800 p-1"
            aria-label="Cerrar"><X aria-hidden="true" size={20} /></button>
        </div>

        <div className="p-5 space-y-5">
          {/* Vehicle */}
          <Section title="Vehículo">
            <InfoRow label="Tipo" value={data.vehicle_type} />
            <InfoRow
              label="Marca / Modelo"
              value={`${data.brand ?? ""} ${data.model ?? ""}`}
            />
            <InfoRow label="Color" value={data.color} />
            {data.year && <InfoRow label="Año" value={String(data.year)} />}
          </Section>

          {/* Customer */}
          <Section title="Cliente">
            <InfoRow
              label="Nombre"
              value={`${data.customer_first_name} ${data.customer_last_name ?? ""}`}
            />
            <InfoRow label="Teléfono" value={data.customer_phone} />
            {data.customer_email && (
              <InfoRow label="Email" value={data.customer_email} />
            )}
          </Section>

          {/* Service */}
          <Section title="Servicio">
            <InfoRow label="Servicio" value={data.service_name} />
            {(data.adicionales?.length ?? 0) > 0 && (
              <InfoRow
                label="Adicionales"
                value={data.adicionales!.map((x) => `${x.nombre} (${formatCOP(x.precio)})`).join(", ")}
              />
            )}
            <InfoRow label="Precio" value={formatCOP(data.price)} bold />
            <InfoRow
              label="Duración estimada"
              value={`${data.estimated_minutes + (data.minutos_adicionales ?? 0)} min`}
            />
            {elapsed && <InfoRow label="Tiempo actual" value={elapsed} />}
            {data.bay_number && (
              <InfoRow label="Bahía" value={`Bahía ${data.bay_number}`} />
            )}
            {data.notes && <InfoRow label="Notas" value={data.notes} />}
          </Section>

          <Section title="Fotos de recepción">
            <FotosRecepcion
              appointmentId={data.id}
              reclamoAbiertoEn={data.reclamo_abierto_at ?? null}
              reclamoNota={data.reclamo_nota ?? null}
            />
          </Section>

          {/* Operator assignment */}
          {(data.status === "pending" || data.status === "in_progress") &&
            operators.length > 0 && (
              <Section title="Operador">
                <select
                  title="Asignar o cambiar el operador responsable de este turno"
                  value={data.assigned_to ?? ""}
                  onChange={(e) => onAssign(data.id, e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 bg-white focus:ring-2 focus:ring-brand-500 outline-none"
                >
                  <option value="">Sin asignar</option>
                  {operators.map((op) => (
                    <option key={op.id} value={op.id}>
                      {op.first_name} {op.last_name ?? ""}
                    </option>
                  ))}
                </select>
              </Section>
            )}

          {/* Status timeline */}
          {data.status_log && data.status_log.length > 0 && (
            <Section title="Historial de estados">
              <div className="space-y-2">
                {data.status_log.map((log, i) => (
                  <div key={i} className="flex items-start gap-3 text-xs">
                    <span className="text-gray-400 whitespace-nowrap">
                      {new Date(log.created_at).toLocaleTimeString("es-CO", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <span className="text-gray-600">
                      {log.previous_status ? `${log.previous_status} → ` : ""}
                      {log.new_status}
                      {log.first_name && (
                        <span className="text-gray-400">
                          {" "}
                          por {log.first_name}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            {accion && (
              <button
                onClick={() => (accion.tipo === "adicional" ? onAdicional(data.id) : onStatusChange(data.id, accion.status))}
                className="flex-1 py-3 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-xl transition text-sm"
              >
                {accion.label}
              </button>
            )}
            {data.status !== "cancelled" && data.status !== "delivered" && (
              <button
                onClick={() => setConfirmCancel(true)}
                className="px-6 py-3 border border-red-200 text-red-600 hover:bg-red-50 font-medium rounded-xl transition text-sm"
              >
                Cancelar
              </button>
            )}
          </div>
        </div>
      </div>

      {confirmCancel && (
        <ConfirmDialog
          title="Cancelar turno"
          message={`¿Seguro que quieres cancelar el turno de la placa ${data.plate}? Esta acción no se puede deshacer.`}
          confirmLabel="Cancelar turno"
          cancelLabel="Volver"
          danger
          onCancel={() => setConfirmCancel(false)}
          onConfirm={() => {
            setConfirmCancel(false);
            onStatusChange(data.id, "cancelled");
          }}
        />
      )}
    </div>
  );
}

// ─── Small components ────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
        {title}
      </h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

interface InfoRowProps {
  label: string;
  value: string | number | null | undefined;
  bold?: boolean;
}

function InfoRow({ label, value, bold }: InfoRowProps) {
  if (!value) return null;
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className={`text-gray-900 ${bold ? "font-semibold" : ""}`}>
        {value}
      </span>
    </div>
  );
}

// ─── Time helpers ─────────────────────────────────────────────────────────────

function getElapsedTime(
  appointment: BoardAppointment | AppointmentDetail,
): string | null {
  const start = inicioDeEspera(appointment);
  if (!start) return null;

  const mins = Math.floor((Date.now() - start.getTime()) / 60_000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

function isOvertimeCheck(appointment: BoardAppointment): boolean {
  if (appointment.status !== "in_progress") return false;
  if (!appointment.started_at || !appointment.estimated_minutes) return false;
  const elapsed =
    (Date.now() - new Date(appointment.started_at).getTime()) / 60_000;
  return elapsed > appointment.estimated_minutes + (appointment.minutos_adicionales ?? 0);
}

/**
 * El tablero es de hoy; esto avisa que hay reservas para los próximos días y
 * lleva a verlas. Sin el aviso, una reserva web para mañana no se veía acá.
 */
function AvisoProximas() {
  const lista = useProximas();
  if (!lista || lista.length === 0) return null;
  const web = lista.filter((t) => t.source === "web").length;
  return (
    <Link to="/" className="inline-block mt-1 text-sm text-brand-700 hover:text-brand-800 font-medium">
      {lista.length} {lista.length === 1 ? "reserva" : "reservas"} para los próximos días
      {web > 0 ? ` (${web} web)` : ""} →
    </Link>
  );
}
