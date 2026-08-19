"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Calendar,
  ChevronDown,
  ChevronUp,
  FileDown,
  FileText,
  Printer,
  Receipt,
  SlidersHorizontal,
} from "lucide-react";
import { ModalCambioPlanGestion } from "@/components/gestion-clientes/ModalCambioPlanGestion";
import { ModalHistorialClienteGestion } from "@/components/gestion-clientes/ModalHistorialClienteGestion";
import { RegistrarPagoModal } from "@/components/pagos/RegistrarPagoModal";
import { EstadoCuentaClienteBlock } from "@/components/cobros/EstadoCuentaClienteBlock";
import { SifenEstadoBadge } from "@/components/sifen/SifenEstadoBadge";
import { useFacturaSifenEstados } from "@/hooks/useFacturaSifenEstados";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { getClientes, clienteNombre } from "@/lib/clientes/storage";
import { etiquetaVisibleTipoServicio } from "@/lib/clientes/tipo-servicio-catalogo";
import { useMapNombreTipoServicioCatalogo } from "@/lib/clientes/use-map-nombre-tipo-servicio";
import { toCalendarDateStr } from "@/lib/fechas/calendario";
import { getFacturas } from "@/lib/gestion-clientes/storage";
import { estadoFacturaParaUi } from "@/lib/gestion-clientes/estado-factura-ui";
import type { Cliente } from "@/lib/clientes/types";
import type { EstadoFactura, Factura } from "@/lib/gestion-clientes/types";

// ── Estilos ────────────────────────────────────────────────────────────────────

const fInputClass =
  "w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#0EA5E9] focus:outline-none bg-white";
const fLabelClass = "mb-0.5 block text-[11px] font-medium text-slate-500";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatGs(n: number) {
  return n.toLocaleString("es-PY");
}

function formatFecha(str: string) {
  if (!str) return "—";
  const [y, m, d] = str.split("-");
  return `${d}/${m}/${y}`;
}

function formatFechaIso(iso: string) {
  try {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  } catch { return ""; }
}

function textoTipoClienteGestion(c: Cliente, mapNombreTipo: Record<string, string>) {
  const base = c.tipo_cliente === "empresa" ? "Empresa" : "Persona";
  const slug = (c.tipo_servicio_cliente ?? "").trim();
  if (!slug) return base;
  return `${base} · ${etiquetaVisibleTipoServicio(slug, mapNombreTipo)}`;
}

/** Misma lógica que en Pagos: solo cobro si hay saldo y el estado de la factura lo permite. */
function facturaPermiteCobro(f: Factura) {
  if (f.saldo <= 0) return false;
  if (f.estado === "Anulado" || f.estado === "Corregida NC") return false;
  return true;
}

// ── Badges ────────────────────────────────────────────────────────────────────

function BadgeEstado({ estado }: { estado: Cliente["estado"] }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-1.5 py-0.5 rounded-full ${
      estado === "activo" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${estado === "activo" ? "bg-green-500" : "bg-gray-400"}`} />
      {estado === "activo" ? "Activo" : "Inactivo"}
    </span>
  );
}

function BadgeFactura({ estado }: { estado: string }) {
  const cfg: Record<string, string> = {
    Pagado:        "bg-green-100 text-green-700",
    Pendiente:     "bg-amber-100 text-amber-700",
    Vencido:       "bg-red-100 text-red-700",
    Anulado:       "bg-gray-100 text-gray-500",
    "Corregida NC": "bg-teal-100 text-teal-800",
  };
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cfg[estado] ?? "bg-gray-100 text-gray-500"}`}>
      {estado === "Corregida NC" ? "Corregida (NC SET)" : estado}
    </span>
  );
}

function BadgeTipo({ tipo }: { tipo: string }) {
  const cfg: Record<string, string> = {
    contado:     "bg-gray-50 text-gray-500 border-gray-200",
    credito:     "bg-blue-50 text-blue-600 border-blue-100",
    suscripcion: "bg-violet-50 text-violet-600 border-violet-100",
  };
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded border capitalize ${cfg[tipo] ?? "bg-gray-50 text-gray-500 border-gray-200"}`}>
      {tipo}
    </span>
  );
}

const KUDE_SOLO_APROBADO_TIP =
  "KuDE (factura electrónica PDF): solo disponible cuando SIFEN está «Aprobado».";

function FacturaRowAccionesSifen({
  facturaId,
  puedeCobrar,
  onCobrar,
  sifenAprobado,
}: {
  facturaId: string;
  sifenAprobado: boolean;
  puedeCobrar: boolean;
  onCobrar?: () => void;
}) {
  const kudeView = `/api/facturas/${facturaId}/sifen/kude`;
  const kudeDl = `/api/facturas/${facturaId}/sifen/kude?download=1`;
  const btnBase =
    "inline-flex items-center justify-center w-8 h-8 rounded-lg transition-colors text-slate-500 hover:text-slate-900 hover:bg-slate-100";
  const disabledCls = "text-slate-200 cursor-not-allowed opacity-45 pointer-events-none";

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {sifenAprobado ? (
        <button
          type="button"
          title="KuDE (PDF)"
          onClick={() => window.open(kudeView, "_blank", "noopener,noreferrer")}
          className={btnBase}
        >
          <FileText className="w-4 h-4" strokeWidth={1.75} />
        </button>
      ) : (
        <button type="button" disabled title={KUDE_SOLO_APROBADO_TIP} className={`${btnBase} ${disabledCls}`}>
          <FileText className="w-4 h-4" strokeWidth={1.75} />
        </button>
      )}
      {sifenAprobado ? (
        <Link
          href={`/facturas/${facturaId}?print=1`}
          className={btnBase}
          title="Imprimir factura"
        >
          <Printer className="w-4 h-4" strokeWidth={1.75} />
        </Link>
      ) : (
        <button type="button" disabled title="KuDE solo si SIFEN aprobado" className={`${btnBase} ${disabledCls}`}>
          <Printer className="w-4 h-4" strokeWidth={1.75} />
        </button>
      )}
      {sifenAprobado ? (
        <a href={kudeDl} download title="Descargar PDF" className={btnBase}>
          <FileDown className="w-4 h-4" strokeWidth={1.75} />
        </a>
      ) : (
        <button type="button" disabled title={KUDE_SOLO_APROBADO_TIP} className={`${btnBase} ${disabledCls}`}>
          <FileDown className="w-4 h-4" strokeWidth={1.75} />
        </button>
      )}
      <Link
        href={`/facturas/${facturaId}`}
        className={btnBase}
        title="Factura y SIFEN"
      >
        <Receipt className="w-4 h-4" strokeWidth={1.75} />
      </Link>
      {puedeCobrar && onCobrar ? (
        <button
          type="button"
          onClick={onCobrar}
          className="ml-0.5 text-[11px] font-semibold text-slate-600 hover:text-slate-900 whitespace-nowrap rounded-md px-1.5 py-1 hover:bg-slate-100"
          title="Registrar cobro (mismo formulario que en Pagos)"
        >
          Cobrar
        </button>
      ) : null}
    </div>
  );
}

// ── Botón operativo ───────────────────────────────────────────────────────────

function BotonOperativo({
  label,
  icon,
  iconNode,
  activo = false,
  href,
  onClick,
}: {
  label:    string;
  icon:     string;
  iconNode?: React.ReactNode;
  activo?:  boolean;
  href?:    string;
  onClick?: () => void;
}) {
  const base =
    "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium transition-colors";
  const activeClass  = "border-gray-800 bg-gray-900 text-white hover:bg-gray-700";
  const disabledClass = "border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed";
  const iconEl = iconNode ?? <span>{icon}</span>;

  if (activo && href) {
    return (
      <Link href={href} className={`${base} ${activeClass}`}>
        {iconEl}
        {label}
      </Link>
    );
  }
  if (activo && onClick) {
    return (
      <button type="button" onClick={onClick} className={`${base} ${activeClass}`}>
        {iconEl}
        {label}
      </button>
    );
  }
  return (
    <button type="button" disabled className={`${base} ${disabledClass}`}>
      {iconEl}
      {label}
    </button>
  );
}

// ── Etiqueta de sección (UI compacta) ─────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{children}</p>
  );
}

function matchesClienteBusqueda(c: Cliente, raw: string) {
  const q = raw.trim().toLowerCase();
  if (!q) return true;
  return (
    (c.empresa ?? "").toLowerCase().includes(q) ||
    c.nombre_contacto.toLowerCase().includes(q) ||
    (c.telefono ?? "").toLowerCase().includes(q) ||
    (c.telefono_secundario ?? "").toLowerCase().includes(q) ||
    (c.ruc ?? "").toLowerCase().includes(q) ||
    (c.documento ?? "").toLowerCase().includes(q) ||
    (c.email ?? "").toLowerCase().includes(q) ||
    (c.email_secundario ?? "").toLowerCase().includes(q) ||
    (c.codigo_cliente ?? "").toLowerCase().includes(q)
  );
}

// ── Modal Estado de Facturación ─────────────────────────────────────────────

const MESES_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

function formatMesLabel(mes: string) {
  const [y, m] = mes.split("-").map(Number);
  return `${MESES_ES[m - 1]} ${y}`;
}

function ModalFacturacion({
  clienteId,
  clienteNombre: nombreCliente,
  onClose,
}: {
  clienteId: string;
  clienteNombre: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{
    facturacion: { mes: string; estado: string; badge_estado: string; factura_id: string | null }[];
    suscripcion: { id: string; precio: number; moneda: string; fecha_inicio: string; duracion_meses: number } | null;
  } | null>(null);
  const [emitiendo, setEmitiendo] = useState<string | null>(null);
  const [errorEmitir, setErrorEmitir] = useState<string | null>(null);

  async function cargar() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithSupabaseSession(`/api/clientes/${clienteId}/facturacion`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Error al cargar");
      setData(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar facturación");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cargar();
  }, [clienteId]);

  async function handleEmitir(mes: string) {
    setEmitiendo(mes);
    setErrorEmitir(null);
    try {
      const res = await fetchWithSupabaseSession(`/api/clientes/${clienteId}/facturacion/emitir`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mes }),
      });
      const json = await res.json();
      if (res.status === 409) {
        setErrorEmitir("Ya existe una factura para este mes");
        return;
      }
      if (!res.ok) throw new Error(json?.error ?? "Error al emitir");
      await cargar();
    } catch (e) {
      setErrorEmitir(e instanceof Error ? e.message : "Error al emitir factura");
    } finally {
      setEmitiendo(null);
    }
  }

  const badgeClass: Record<string, string> = {
    emitida:   "bg-green-100 text-green-700",
    proyectada: "bg-gray-100 text-gray-600",
    vencida:  "bg-red-100 text-red-700",
    pendiente: "bg-amber-100 text-amber-700",
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-bold text-gray-900">Estado de Facturación</h3>
          <p className="text-sm text-gray-500 mt-0.5">{nombreCliente}</p>
          {data?.suscripcion && (
            <p className="text-sm font-medium text-gray-700 mt-2">
              Suscripción mensual — {data.suscripcion.moneda === "USD" ? "USD" : "Gs."} {data.suscripcion.precio.toLocaleString("es-PY")}
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="py-12 text-center text-sm text-gray-500">Cargando...</div>
          ) : error ? (
            <div className="py-12 text-center text-sm text-red-600">{error}</div>
          ) : !data?.suscripcion ? (
            <div className="py-12 text-center text-sm text-gray-500">
              Este cliente no tiene suscripción activa para proyectar facturación.
            </div>
          ) : (
            <div className="space-y-4">
              {errorEmitir && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                  <span>⚠</span>
                  <span>{errorEmitir}</span>
                </div>
              )}
              <div className="space-y-2">
                {data.facturacion.map((item) => (
                  <div
                    key={item.mes}
                    className="flex items-center justify-between gap-4 py-3 px-4 rounded-lg border border-gray-100 hover:bg-gray-50/60"
                  >
                    <div>
                      <p className="text-sm font-semibold text-gray-800">{formatMesLabel(item.mes)}</p>
                      <span className={`inline-flex text-xs font-medium px-2 py-0.5 rounded-full mt-1 ${badgeClass[item.badge_estado] ?? badgeClass.proyectada}`}>
                        {item.badge_estado === "emitida" ? "Emitida" : item.badge_estado === "proyectada" ? "Proyectada" : item.badge_estado === "vencida" ? "Vencida" : "Pendiente"}
                      </span>
                    </div>
                    <div className="shrink-0 text-sm font-semibold text-gray-700 tabular-nums">
                      {data.suscripcion?.moneda === "USD" ? "USD" : "Gs."} {(data.suscripcion?.precio ?? 0).toLocaleString("es-PY")}
                    </div>
                    <div className="shrink-0">
                      {item.estado === "proyectada" && (
                        <button
                          type="button"
                          disabled={emitiendo === item.mes}
                          onClick={() => handleEmitir(item.mes)}
                          className="text-xs font-medium text-[#0EA5E9] hover:text-[#0284C7] hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {emitiendo === item.mes ? "Emitiendo..." : "Emitir factura"}
                        </button>
                      )}
                      {item.factura_id && (
                        <Link
                          href={`/facturas/${item.factura_id}`}
                          className="text-xs font-medium text-[#0EA5E9] hover:text-[#0284C7] hover:underline"
                        >
                          Ver factura
                        </Link>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="shrink-0 px-6 py-4 border-t border-gray-200">
          <button
            type="button"
            onClick={onClose}
            className="w-full text-sm font-medium text-gray-600 border border-gray-200 rounded-lg py-2.5 hover:bg-gray-50 transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Búsqueda global de cliente (barra única, misma lógica de coincidencia en cliente) ─

function IconoLupa({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  );
}

function ClienteBusquedaGlobal({
  clientes,
  selected,
  onSelect,
  onClear,
  variant,
}: {
  clientes: Cliente[];
  selected: Cliente | null;
  onSelect: (c: Cliente) => void;
  onClear: () => void;
  variant: "landing" | "toolbar";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const resultados = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? clientes.filter((c) => matchesClienteBusqueda(c, q))
      : [...clientes].sort((a, b) =>
          clienteNombre(a).localeCompare(clienteNombre(b), "es", { sensitivity: "base" })
        );
    return base.slice(0, q ? 50 : 24);
  }, [clientes, query]);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        if (variant === "toolbar") setQuery("");
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open, variant]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  function handleSelect(c: Cliente) {
    onSelect(c);
    setOpen(false);
    setQuery("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    } else if (e.key === "Enter" && resultados.length > 0) {
      handleSelect(resultados[0]);
    }
  }

  if (variant === "toolbar" && selected && !open) {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setQuery("");
            setOpen(true);
          }}
          className="inline-flex max-w-full min-w-0 items-center gap-2 rounded-lg border border-slate-200/90 bg-white px-2.5 py-1.5 text-left text-xs font-medium text-slate-800 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
          title="Buscar otro cliente"
        >
          <IconoLupa className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span className="min-w-0 truncate">{clienteNombre(selected)}</span>
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Cambiar</span>
        </button>
        <button
          type="button"
          onClick={onClear}
          className="shrink-0 rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          title="Quitar cliente"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    );
  }

  const shellClass =
    variant === "landing"
      ? "w-full rounded-xl border border-slate-200/90 bg-white shadow-sm ring-1 ring-slate-900/[0.04] transition focus-within:border-sky-400/80 focus-within:ring-2 focus-within:ring-sky-200/70"
      : "w-full min-w-[200px] rounded-lg border border-slate-200 bg-white shadow-lg ring-1 ring-slate-900/5 transition focus-within:border-sky-400/80 focus-within:ring-2 focus-within:ring-sky-200/70";

  return (
    <div
      ref={containerRef}
      className={`relative ${variant === "landing" ? "mx-auto w-full max-w-2xl" : "min-w-0 flex-1"}`}
    >
      <div className={shellClass}>
        <div className="flex items-center gap-2 px-3 py-2 sm:py-2.5">
          <IconoLupa className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            ref={inputRef}
            type="search"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setOpen(true)}
            placeholder="Nombre, RUC, teléfono, correo, documento, código…"
            className="min-w-0 flex-1 border-0 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
            aria-label="Buscar cliente"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            >
              Limpiar
            </button>
          ) : null}
          {variant === "toolbar" && selected && open ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setQuery("");
              }}
              className="shrink-0 text-[11px] font-semibold text-slate-500 hover:text-slate-800"
            >
              Listo
            </button>
          ) : null}
        </div>
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="max-h-64 overflow-y-auto overscroll-y-contain">
            {resultados.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-slate-400">
                {query.trim() ? <>Sin resultados para &ldquo;{query.trim()}&rdquo;</> : <>Sin clientes cargados</>}
              </div>
            ) : (
              resultados.map((c, i) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => handleSelect(c)}
                  className={`w-full border-b border-slate-100 px-3 py-2 text-left transition last:border-0 hover:bg-slate-50 ${
                    i === 0 && query.trim() ? "bg-sky-50/70" : ""
                  }`}
                >
                  <p className="truncate text-xs font-semibold text-slate-900">{clienteNombre(c)}</p>
                  <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
                    <span className="font-mono text-[10px] text-slate-400">{c.codigo_cliente}</span>
                    {c.ruc ? <span className="text-[10px] text-slate-500">RUC {c.ruc}</span> : null}
                    {c.telefono ? <span className="text-[10px] text-slate-500">{c.telefono}</span> : null}
                  </div>
                </button>
              ))
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 bg-slate-50 px-3 py-1.5 text-[10px] text-slate-400">
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded border border-slate-200 bg-white px-1 py-0.5 font-mono text-[9px] leading-none">↵</kbd>
              primer resultado
            </span>
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded border border-slate-200 bg-white px-1 py-0.5 font-mono text-[9px] leading-none">Esc</kbd>
              cerrar
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────

function GestionClientesPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [clientes,  setClientes]  = useState<Cliente[]>([]);
  const [selected,  setSelected]  = useState<Cliente | null>(null);
  const [facturas,  setFacturas]  = useState<Factura[]>([]);
  const [modalFacturacion, setModalFacturacion] = useState(false);
  const [modalCambioPlan, setModalCambioPlan] = useState(false);
  const [modalHistorialCliente, setModalHistorialCliente] = useState(false);
  const [facturaCobroModal, setFacturaCobroModal] = useState<Factura | null>(null);
  const [facturasDetalleAbierto, setFacturasDetalleAbierto] = useState(true);
  const [panelFiltrosFacturas, setPanelFiltrosFacturas] = useState(false);
  /** Evita carrera: al limpiar, `?cliente=` aún no se quitó y el efecto URL→estado reabría la ficha. */
  const omitirUrlASeleccion = useRef(false);
  const mapNombreTipoCatalogo = useMapNombreTipoServicioCatalogo(clientes);

  const [filters, setFilters] = useState({
    fecha_desde:             "",
    fecha_hasta:             "",
    vencimiento_desde:       "",
    vencimiento_hasta:       "",
    incluir_saldo_cero:      true,
    incluir_factura_contado: true,
    moneda:                  "" as "" | "GS" | "USD",
  });

  useEffect(() => {
    getClientes().then(setClientes);
  }, []);

  /** Al elegir cliente: misma API que la ficha (`/api/facturas?cliente_id=`) y filtros de período en blanco para no ocultar filas. */
  const selectCliente = useCallback(
    (c: Cliente) => {
      setSelected(c);
      setFilters({
        fecha_desde: "",
        fecha_hasta: "",
        vencimiento_desde: "",
        vencimiento_hasta: "",
        moneda: "",
        incluir_saldo_cero: true,
        incluir_factura_contado: true,
      });
      setPanelFiltrosFacturas(false);
      getFacturas(c.id).then(setFacturas);
      router.replace(`/gestion-clientes?cliente=${encodeURIComponent(c.id)}`, { scroll: false });
    },
    [router]
  );

  useEffect(() => {
    const cid = searchParams?.get("cliente")?.trim() || null;
    if (omitirUrlASeleccion.current) {
      if (!cid) omitirUrlASeleccion.current = false;
      return;
    }
    if (!cid || clientes.length === 0) return;
    if (selected?.id === cid) return;
    const c = clientes.find((x) => x.id === cid);
    if (!c) return;
    const t = window.setTimeout(() => {
      selectCliente(c);
    }, 0);
    return () => window.clearTimeout(t);
  }, [searchParams, clientes, selected?.id, selectCliente]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;
    setFilters((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  }

  function limpiarFiltrosFacturas() {
    setFilters({
      fecha_desde: "",
      fecha_hasta: "",
      vencimiento_desde: "",
      vencimiento_hasta: "",
      incluir_saldo_cero: true,
      incluir_factura_contado: true,
      moneda: "",
    });
  }

  // Handlers del lookup
  function handleSelectFromLookup(c: Cliente) {
    selectCliente(c);
  }

  function handleClearLookup() {
    omitirUrlASeleccion.current = true;
    setSelected(null);
    setFacturas([]);
    setFacturaCobroModal(null);
    limpiarFiltrosFacturas();
    setPanelFiltrosFacturas(false);
    router.replace("/gestion-clientes", { scroll: false });
  }

  const filtrosFacturasActivos = useMemo(() => {
    return Boolean(
      filters.fecha_desde.trim() ||
        filters.fecha_hasta.trim() ||
        filters.vencimiento_desde.trim() ||
        filters.vencimiento_hasta.trim() ||
        filters.moneda ||
        !filters.incluir_saldo_cero ||
        !filters.incluir_factura_contado
    );
  }, [filters]);

  // ── Filtrado de facturas ─────────────────────────────────────────────────

  const facturasFiltradas = useMemo(() => {
    const fd = toCalendarDateStr(filters.fecha_desde) || filters.fecha_desde.trim();
    const fh = toCalendarDateStr(filters.fecha_hasta) || filters.fecha_hasta.trim();
    const vd = toCalendarDateStr(filters.vencimiento_desde) || filters.vencimiento_desde.trim();
    const vh = toCalendarDateStr(filters.vencimiento_hasta) || filters.vencimiento_hasta.trim();
    return facturas.filter((f) => {
      const fEmi = toCalendarDateStr(f.fecha) || String(f.fecha).slice(0, 10);
      const fVen = toCalendarDateStr(f.fecha_vencimiento) || String(f.fecha_vencimiento).slice(0, 10);
      if (fd && fEmi < fd) return false;
      if (fh && fEmi > fh) return false;
      if (vd && fVen < vd) return false;
      if (vh && fVen > vh) return false;
      if (!filters.incluir_saldo_cero && f.saldo === 0) return false;
      if (!filters.incluir_factura_contado && f.tipo === "contado") return false;
      if (filters.moneda) {
        const mon = String(f.moneda ?? "").toUpperCase() === "USD" ? "USD" : "GS";
        if (mon !== filters.moneda) return false;
      }
      return true;
    });
  }, [facturas, filters.fecha_desde, filters.fecha_hasta, filters.vencimiento_desde, filters.vencimiento_hasta, filters.incluir_saldo_cero, filters.incluir_factura_contado, filters.moneda]);

  // ── Fecha de hoy para mora/estado automático ─────────────────────────────

  const hoyStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  // ── Facturas enriquecidas: estado efectivo + días mora + ordenadas DESC ───

  const facturasOrdenadas = useMemo(() => {
    return [...facturasFiltradas]
      .sort((a, b) => {
        const av = toCalendarDateStr(a.fecha_vencimiento) || String(a.fecha_vencimiento).slice(0, 10);
        const bv = toCalendarDateStr(b.fecha_vencimiento) || String(b.fecha_vencimiento).slice(0, 10);
        return bv.localeCompare(av);
      })
      .map((f) => {
        const fv = toCalendarDateStr(f.fecha_vencimiento) || String(f.fecha_vencimiento).slice(0, 10);
        const estadoEfectivo = estadoFacturaParaUi(f, hoyStr) as EstadoFactura;
        const diasMora =
          estadoEfectivo === "Vencido" && fv.length >= 10
            ? Math.floor(
                (new Date().getTime() - new Date(`${fv}T00:00:00`).getTime()) /
                  86_400_000
              )
            : 0;
        return { ...f, _estadoEfectivo: estadoEfectivo, _diasMora: diasMora };
      });
  }, [facturasFiltradas, hoyStr]);

  // ── Totales de facturas ──────────────────────────────────────────────────

  const totalMonto    = facturasOrdenadas.reduce((s, f) => s + f.monto, 0);
  const totalSaldo    = facturasOrdenadas.reduce((s, f) => s + f.saldo, 0);
  const cntVencidas     = facturasOrdenadas.filter((f) => f._estadoEfectivo === "Vencido").length;
  const cntPendientes   = facturasOrdenadas.filter((f) => f._estadoEfectivo === "Pendiente").length;
  const cntPagadas      = facturasOrdenadas.filter((f) => f._estadoEfectivo === "Pagado").length;
  const cntCorregidaNc  = facturasOrdenadas.filter((f) => f._estadoEfectivo === "Corregida NC").length;

  const sifenPorFactura = useFacturaSifenEstados(facturasOrdenadas.map((f) => f.id));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <header className="shrink-0 border-b border-slate-200/80 pb-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-slate-900">Gestión del Cliente</h1>
            <p className="text-[11px] text-slate-500">Panel operativo · consultas y tipificaciones</p>
          </div>
          {clientes.length > 0 ? (
            <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400 tabular-nums">
              {clientes.length} en cartera
            </span>
          ) : null}
        </div>
      </header>

      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-sm ring-1 ring-slate-900/[0.03]"
        style={{ minHeight: "min(560px, calc(100dvh - 10.5rem))" }}
      >
        {selected === null ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-5 px-4 py-8">
            <div className="space-y-1 text-center">
              <p className="text-sm font-semibold text-slate-800">Buscá un cliente</p>
              <p className="mx-auto max-w-md text-xs leading-relaxed text-slate-500">
                Un solo campo cubre nombre, razón social, RUC, teléfonos, correos, documento y código interno.
              </p>
            </div>
            <ClienteBusquedaGlobal
              variant="landing"
              clientes={clientes}
              selected={null}
              onSelect={handleSelectFromLookup}
              onClear={handleClearLookup}
            />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0 border-b border-slate-200/80 bg-slate-50/70">
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 sm:px-4">
                <ClienteBusquedaGlobal
                  variant="toolbar"
                  clientes={clientes}
                  selected={selected}
                  onSelect={handleSelectFromLookup}
                  onClear={handleClearLookup}
                />
                <button
                  type="button"
                  onClick={() => setPanelFiltrosFacturas((v) => !v)}
                  aria-expanded={panelFiltrosFacturas}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition ${
                    panelFiltrosFacturas || filtrosFacturasActivos
                      ? "border-sky-300 bg-sky-50 text-sky-900"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                  }`}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
                  Filtros facturas
                  {filtrosFacturasActivos ? (
                    <span className="ml-0.5 inline-flex h-1.5 w-1.5 rounded-full bg-sky-500" title="Hay filtros aplicados" />
                  ) : null}
                </button>
              </div>
              {panelFiltrosFacturas ? (
                <div className="space-y-3 border-t border-slate-200/70 bg-white px-3 py-3 sm:px-4">
                  <SectionLabel>Filtros sobre el listado de facturas</SectionLabel>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <label className={fLabelClass}>Fecha emisión desde</label>
                      <input type="date" name="fecha_desde" value={filters.fecha_desde} onChange={handleChange} className={fInputClass} />
                    </div>
                    <div>
                      <label className={fLabelClass}>Fecha emisión hasta</label>
                      <input type="date" name="fecha_hasta" value={filters.fecha_hasta} onChange={handleChange} className={fInputClass} />
                    </div>
                    <div>
                      <label className={fLabelClass}>Vencimiento desde</label>
                      <input type="date" name="vencimiento_desde" value={filters.vencimiento_desde} onChange={handleChange} className={fInputClass} />
                    </div>
                    <div>
                      <label className={fLabelClass}>Vencimiento hasta</label>
                      <input type="date" name="vencimiento_hasta" value={filters.vencimiento_hasta} onChange={handleChange} className={fInputClass} />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-4 border-t border-slate-100 pt-3">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        name="incluir_saldo_cero"
                        checked={filters.incluir_saldo_cero}
                        onChange={handleChange}
                        className="rounded border-gray-300 accent-gray-800"
                      />
                      <span className="text-xs text-slate-600">Incluir saldo cero</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        name="incluir_factura_contado"
                        checked={filters.incluir_factura_contado}
                        onChange={handleChange}
                        className="rounded border-gray-300 accent-gray-800"
                      />
                      <span className="text-xs text-slate-600">Incluir factura contado</span>
                    </label>
                    <div className="min-w-[10rem] flex-1">
                      <label className={fLabelClass}>Moneda</label>
                      <select name="moneda" value={filters.moneda} onChange={handleChange} className={fInputClass}>
                        <option value="">Todas</option>
                        <option value="GS">Guaraníes (GS)</option>
                        <option value="USD">Dólares (USD)</option>
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={limpiarFiltrosFacturas}
                      className="self-end rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                    >
                      Restablecer filtros
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
              <section className="border-b border-slate-200/80 px-3 py-3 sm:px-5 sm:py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <h2 className="text-base font-semibold tracking-tight text-slate-900 sm:text-lg">
                      {clienteNombre(selected)}
                    </h2>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
                      <span className="font-mono text-slate-400">{selected.codigo_cliente}</span>
                      {selected.ruc ? <span>· RUC {selected.ruc}</span> : null}
                      {selected.documento && !selected.ruc ? <span>· Doc. {selected.documento}</span> : null}
                    </div>
                  </div>
                  <BadgeEstado estado={selected.estado} />
                </div>

                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {[
                    { label: "RUC", value: selected.ruc ?? "—" },
                    { label: "Contacto", value: selected.nombre_contacto },
                    { label: "Correo", value: selected.email ?? "—" },
                    { label: "Teléfono", value: selected.telefono ?? "—" },
                    { label: "Dirección", value: selected.direccion ?? "—" },
                    { label: "Tipo de cliente", value: textoTipoClienteGestion(selected, mapNombreTipoCatalogo) },
                    { label: "Ciudad", value: selected.ciudad ?? "—" },
                    { label: "Condición", value: selected.condicion_pago ?? "—" },
                    { label: "Moneda", value: selected.moneda_preferida ?? "GS" },
                    { label: "Fecha alta", value: formatFechaIso(selected.created_at) },
                  ].map((item) => (
                    <div key={item.label} className="min-w-0">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{item.label}</p>
                      <p className="truncate text-xs font-medium text-slate-800" title={item.value}>
                        {item.value}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">
                  <BotonOperativo label="Tipificación" icon="📋" activo href={`/clientes/${selected.id}/tipificacion`} />
                  <BotonOperativo
                    label="Facturación"
                    icon="📄"
                    iconNode={<Calendar className="h-3.5 w-3.5" />}
                    activo
                    onClick={() => setModalFacturacion(true)}
                  />
                  <BotonOperativo label="Servicios asociados" icon="🔗" />
                  <BotonOperativo
                    label="Cambio de plan"
                    icon="🔄"
                    activo
                    onClick={() => setModalCambioPlan(true)}
                  />
                  <BotonOperativo label="Cambio fecha venc." icon="📅" />
                  <BotonOperativo
                    label="Historial cliente"
                    icon="🕐"
                    activo
                    onClick={() => setModalHistorialCliente(true)}
                  />
                </div>
              </section>

              {/* Estado de cuenta (nueva lógica: cuentas por cobrar de ventas a crédito + cobros) */}
              <EstadoCuentaClienteBlock clienteId={selected.id} />

              {/* Bloque legacy de facturas (planes/SIFEN): solo se muestra si el cliente tiene facturas. */}
              {facturas.length > 0 ? (
              <section>
                <button
                  type="button"
                  onClick={() => setFacturasDetalleAbierto((v) => !v)}
                  className="flex w-full items-center justify-between gap-2 border-b border-slate-200/60 bg-slate-50/90 px-3 py-2.5 text-left transition hover:bg-slate-100/90 sm:px-4"
                >
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5">
                    <span className="inline-flex shrink-0 text-slate-500" aria-hidden>
                      {facturasDetalleAbierto ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </span>
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">Facturas</span>
                    <span className="hidden text-[10px] font-normal text-slate-400 sm:inline">del cliente</span>
                    {facturasFiltradas.length !== facturas.length ? (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800 ring-1 ring-amber-200/80">
                        {facturasFiltradas.length}/{facturas.length} con filtros
                      </span>
                    ) : null}
                    <span className="hidden h-3 w-px bg-slate-200 sm:inline" />
                    <span className="rounded-md bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-700 ring-1 ring-slate-200/80">
                      {facturasOrdenadas.length} docs
                    </span>
                    <span className="rounded-md bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-700 ring-1 ring-slate-200/80">
                      Saldo Gs. {formatGs(totalSaldo)}
                    </span>
                    {cntVencidas > 0 ? (
                      <span className="rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 ring-1 ring-red-100">
                        {cntVencidas} venc.
                      </span>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-[10px] font-semibold text-sky-700">
                    {facturasDetalleAbierto ? "Ocultar detalle" : "Ver detalle"}
                  </span>
                </button>

                {facturasDetalleAbierto ? (
                  <div>
                    {facturasOrdenadas.length > 0 ? (
                      <div className="grid grid-cols-2 gap-1.5 border-b border-slate-100 bg-slate-50/50 p-2 sm:grid-cols-3 lg:grid-cols-6">
                        <div className="rounded-lg border border-slate-100 bg-white px-2 py-1.5">
                          <p className="text-[10px] text-slate-400">Facturas</p>
                          <p className="text-sm font-bold tabular-nums text-slate-800">{facturasOrdenadas.length}</p>
                        </div>
                        <div className="rounded-lg border border-slate-100 bg-white px-2 py-1.5">
                          <p className="text-[10px] text-slate-400">Monto total</p>
                          <p className="text-[11px] font-bold tabular-nums leading-snug text-slate-800">Gs. {formatGs(totalMonto)}</p>
                        </div>
                        <div className="rounded-lg border border-slate-100 bg-white px-2 py-1.5">
                          <p className="text-[10px] text-slate-400">Saldo pend.</p>
                          <p
                            className={`text-[11px] font-bold tabular-nums leading-snug ${
                              totalSaldo > 0 ? "text-red-600" : "text-emerald-600"
                            }`}
                          >
                            Gs. {formatGs(totalSaldo)}
                          </p>
                        </div>
                        <div className="rounded-lg border border-red-100 bg-white px-2 py-1.5">
                          <p className="text-[10px] text-red-500">Vencidas</p>
                          <p className="text-sm font-bold text-red-600">{cntVencidas}</p>
                        </div>
                        <div className="rounded-lg border border-amber-100 bg-white px-2 py-1.5">
                          <p className="text-[10px] text-amber-600">Pendientes</p>
                          <p className="text-sm font-bold text-amber-700">{cntPendientes}</p>
                        </div>
                        <div className="rounded-lg border border-emerald-100 bg-white px-2 py-1.5">
                          <p className="text-[10px] text-emerald-600">Pagadas</p>
                          <p className="text-sm font-bold text-emerald-700">{cntPagadas}</p>
                        </div>
                        <div className="rounded-lg border border-teal-100 bg-white px-2 py-1.5">
                          <p className="text-[10px] text-teal-700">NC (SET)</p>
                          <p className="text-sm font-bold text-teal-800">{cntCorregidaNc}</p>
                        </div>
                      </div>
                    ) : null}

                    {facturasOrdenadas.length === 0 ? (
                      <div className="space-y-2 px-4 py-10 text-center text-sm text-slate-400">
                        <p>No hay facturas para los filtros seleccionados.</p>
                        {facturas.length > 0 ? (
                          <p className="text-xs text-amber-700">
                            Hay {facturas.length} factura(s) cargadas; revisá período, moneda o «Incluir factura contado».
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[1040px] text-sm">
                          <thead className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50 shadow-sm">
                            <tr>
                              {[
                                "Tipo",
                                "Nro. Factura",
                                "Fecha emisión",
                                "Fecha vencimiento",
                                "Monto",
                                "Saldo",
                                "Días mora",
                                "Estado",
                                "Pago registrado",
                                "SIFEN",
                                "Operación",
                              ].map((h) => (
                                <th
                                  key={h}
                                  className="whitespace-nowrap px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-600 sm:px-3 sm:text-xs"
                                >
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {facturasOrdenadas.map((f) => (
                              <tr
                                key={f.id}
                                className={`transition-colors ${
                                  f._estadoEfectivo === "Vencido" ? "bg-red-50/50 hover:bg-red-50/80" : "hover:bg-slate-50/80"
                                }`}
                              >
                                <td className="px-2 py-2 sm:px-3">
                                  <BadgeTipo tipo={f.tipo} />
                                </td>
                                <td className="px-2 py-2 sm:px-3">
                                  <Link
                                    href={`/facturas/${f.id}`}
                                    className="font-mono text-xs font-semibold text-sky-600 hover:text-sky-800 hover:underline"
                                  >
                                    {f.numero_factura}
                                  </Link>
                                </td>
                                <td className="whitespace-nowrap px-2 py-2 text-xs text-slate-500 sm:px-3">{formatFecha(f.fecha)}</td>
                                <td
                                  className={`whitespace-nowrap px-2 py-2 text-xs font-medium sm:px-3 ${
                                    f._estadoEfectivo === "Vencido" ? "text-red-600" : "text-slate-600"
                                  }`}
                                >
                                  {formatFecha(f.fecha_vencimiento)}
                                </td>
                                <td className="whitespace-nowrap px-2 py-2 text-xs tabular-nums text-slate-800 sm:px-3">
                                  {f.moneda === "GS" ? `Gs. ${formatGs(f.monto)}` : `USD ${f.monto.toLocaleString("en-US")}`}
                                </td>
                                <td
                                  className={`whitespace-nowrap px-2 py-2 text-xs tabular-nums font-semibold sm:px-3 ${
                                    f.saldo > 0 ? "text-red-600" : "text-slate-400"
                                  }`}
                                >
                                  {f.moneda === "GS" ? `Gs. ${formatGs(f.saldo)}` : `USD ${f.saldo.toLocaleString("en-US")}`}
                                </td>
                                <td className="px-2 py-2 text-center text-xs sm:px-3">
                                  {f._diasMora > 0 ? (
                                    <span className="font-bold tabular-nums text-red-600">{f._diasMora}</span>
                                  ) : (
                                    <span className="text-slate-300">—</span>
                                  )}
                                </td>
                                <td className="px-2 py-2 sm:px-3">
                                  <BadgeFactura estado={f._estadoEfectivo} />
                                </td>
                                <td className="whitespace-nowrap px-2 py-2 text-xs text-slate-600 sm:px-3">
                                  {f.fecha_pago_registro ? formatFecha(f.fecha_pago_registro) : "—"}
                                </td>
                                <td className="align-middle px-2 py-2.5 sm:px-3">
                                  <div className="flex items-center min-h-[2rem]">
                                    <SifenEstadoBadge
                                      estadoSifen={sifenPorFactura[f.id]?.estado_sifen ?? null}
                                      mostrarPistaEnvioSet={false}
                                    />
                                  </div>
                                </td>
                                <td className="align-middle px-2 py-2.5 sm:px-3">
                                  <FacturaRowAccionesSifen
                                    facturaId={f.id}
                                    sifenAprobado={sifenPorFactura[f.id]?.estado_sifen === "aprobado"}
                                    puedeCobrar={facturaPermiteCobro(f)}
                                    onCobrar={() => setFacturaCobroModal(f)}
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {facturasOrdenadas.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 bg-slate-50/60 px-3 py-2 text-[11px] text-slate-500 sm:px-4">
                        <span className="tabular-nums">
                          <span className="font-semibold text-slate-700">{facturasOrdenadas.length}</span> facturas
                          {facturasFiltradas.length !== facturas.length ? <span className="text-slate-400"> (filtradas)</span> : null}
                        </span>
                        <span className="tabular-nums">
                          Total: <span className="font-semibold text-slate-700">Gs. {formatGs(totalMonto)}</span>
                        </span>
                        <span className="tabular-nums">
                          Saldo:{" "}
                          <span className={`font-semibold ${totalSaldo > 0 ? "text-red-600" : "text-emerald-700"}`}>Gs. {formatGs(totalSaldo)}</span>
                        </span>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </section>
              ) : null}
            </div>
          </div>
        )}
      </div>
      {/* Modal Estado de Facturación */}
      {modalFacturacion && selected && (
        <ModalFacturacion
          clienteId={selected.id}
          clienteNombre={clienteNombre(selected)}
          onClose={() => setModalFacturacion(false)}
        />
      )}
      {modalCambioPlan && selected && (
        <ModalCambioPlanGestion
          clienteId={selected.id}
          clienteNombre={clienteNombre(selected)}
          onClose={() => setModalCambioPlan(false)}
          onExito={async () => {
            if (selected) {
              getFacturas(selected.id).then(setFacturas);
              getClientes().then(setClientes);
            }
          }}
        />
      )}
      {modalHistorialCliente && selected && (
        <ModalHistorialClienteGestion
          clienteId={selected.id}
          clienteNombre={clienteNombre(selected)}
          onClose={() => setModalHistorialCliente(false)}
        />
      )}
      <RegistrarPagoModal
        open={!!facturaCobroModal}
        factura={
          facturaCobroModal
            ? {
                id: facturaCobroModal.id,
                numero_factura: facturaCobroModal.numero_factura,
                saldo: facturaCobroModal.saldo,
                moneda: facturaCobroModal.moneda,
              }
            : null
        }
        onClose={() => setFacturaCobroModal(null)}
        onExito={async () => {
          if (selected) getFacturas(selected.id).then(setFacturas);
        }}
      />
    </div>
  );
}

export default function GestionClientesPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[35vh] flex items-center justify-center text-sm text-slate-400">
          Cargando gestión de clientes…
        </div>
      }
    >
      <GestionClientesPageInner />
    </Suspense>
  );
}
