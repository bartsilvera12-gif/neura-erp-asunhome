"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { getFacturacionEstado, asMetadataObject } from "@/lib/caja/facturacion";
import {
  ProyectoModuloSelector,
  type ProyectoModuloCatalogo as ModuloCatalogo,
} from "@/app/dashboard/proyectos/components/ProyectoModuloSelector";
import {
  PROYECTO_DATOS_BRIEF_FIELDS,
  applyBriefFormToExisting,
  applySaasFormToExisting,
  coalesceBriefData,
  formatFechaPyFull,
  readSaasBriefData,
  type ProyectoModuloSnapshot,
  type ProyectoSaasBriefForm,
} from "@/lib/proyectos/brief-data";

export type DetalleResp = {
  proyecto: Record<string, unknown> & {
    id: string;
    titulo?: string;
    brief_data?: Record<string, unknown>;
    tipo_id?: string;
    estado_id?: string;
    proyecto_tipo?: { codigo?: string };
  };
  historial: Record<string, unknown>[];
  sla: Record<string, unknown>;
  tareas: Record<string, unknown>[];
  comentarios: Record<string, unknown>[];
  archivos: Record<string, unknown>[];
  avance_pct: number | null;
};

type UsuarioActivo = { id: string; nombre?: string | null; email?: string | null };

const TAB_IDS = ["resumen", "datos", "tareas", "comentarios", "archivos", "historial"] as const;
export type TabId = (typeof TAB_IDS)[number];

const TAB_LABELS: Record<TabId, string> = {
  resumen: "Resumen",
  datos: "Datos",
  tareas: "Tareas",
  comentarios: "Comentarios",
  archivos: "Archivos",
  historial: "Historial",
};

function normalizeTab(raw: string | null | undefined): TabId {
  if (!raw) return "resumen";
  if (raw === "brief") return "datos";
  return (TAB_IDS as readonly string[]).includes(raw) ? (raw as TabId) : "resumen";
}

function clienteNombre(p: Record<string, unknown>): string {
  const c = p.cliente as { empresa?: string | null; nombre_contacto?: string | null } | undefined;
  if (!c) return "—";
  const a = (c.empresa ?? "").trim();
  const b = (c.nombre_contacto ?? "").trim();
  if (a && b) return `${a} · ${b}`;
  return a || b || "—";
}

function prioridadLabel(value: unknown): string {
  if (value === "normal") return "Media";
  if (value === "baja") return "Baja";
  if (value === "alta") return "Alta";
  if (value === "urgente") return "Urgente";
  return value == null ? "—" : String(value);
}

export type ProyectoDetalleInnerProps = {
  projectId: string;
  variant: "page" | "modal";
  onClose?: () => void;
  onProjectUpdated?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
};

export default function ProyectoDetalleInner({
  projectId,
  variant,
  onClose,
  onProjectUpdated,
  onDirtyChange,
}: ProyectoDetalleInnerProps) {
  const router = useRouter();
  const sp = useSearchParams();
  const tabUrl = variant === "page" ? normalizeTab(sp?.get("tab")) : null;
  const [modalTab, setModalTab] = useState<TabId>("resumen");

  const tab = variant === "page" ? (tabUrl ?? "resumen") : modalTab;

  const setTab = useCallback(
    (t: TabId) => {
      if (variant === "modal") setModalTab(t);
      else router.replace(`/dashboard/proyectos/${projectId}?tab=${t}`);
    },
    [variant, router, projectId]
  );

  const [data, setData] = useState<DetalleResp | null>(null);
  const [estados, setEstados] = useState<{ id: string; nombre: string }[]>([]);
  const [usuarios, setUsuarios] = useState<UsuarioActivo[]>([]);
  const [modulosCatalogo, setModulosCatalogo] = useState<ModuloCatalogo[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [comTexto, setComTexto] = useState("");
  const [tareaTitulo, setTareaTitulo] = useState("");

  const [briefForm, setBriefForm] = useState<Record<string, string>>({});
  const [saasForm, setSaasForm] = useState<ProyectoSaasBriefForm>({
    empresa_nombre: "",
    whatsapp_contacto: "",
    observaciones: "",
    modulos_necesarios: [],
  });
  const [responsableTecnicoId, setResponsableTecnicoId] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [datosSnapshot, setDatosSnapshot] = useState("");

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setErr(null);
    const res = await fetchWithSupabaseSession(`/api/proyectos/${projectId}`, { cache: "no-store" });
    const j = (await res.json()) as { success?: boolean; data?: DetalleResp; error?: string };
    if (!res.ok || !j.success || !j.data) {
      setErr(j.error ?? "Error al cargar");
      setLoading(false);
      return;
    }
    setData(j.data);
    const p = j.data.proyecto;
    const merged = coalesceBriefData(p.brief_data);
    const saas = readSaasBriefData(p.brief_data);
    setBriefForm(merged);
    setSaasForm(saas);
    setResponsableTecnicoId(typeof p.responsable_tecnico_id === "string" ? p.responsable_tecnico_id : "");
    setObservaciones(typeof p.observaciones_comerciales === "string" ? p.observaciones_comerciales : "");
    setDatosSnapshot(JSON.stringify({
      bf: merged,
      saas,
      responsable_tecnico_id: typeof p.responsable_tecnico_id === "string" ? p.responsable_tecnico_id : "",
      obs: typeof p.observaciones_comerciales === "string" ? p.observaciones_comerciales : "",
    }));
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (variant !== "page" || !projectId) return;
    const raw = sp?.get("tab");
    if (raw === "brief") {
      router.replace(`/dashboard/proyectos/${projectId}?tab=datos`);
    }
  }, [variant, projectId, sp, router]);

  useEffect(() => {
    let c = false;
    (async () => {
      const [r, rUsers, rModulos] = await Promise.all([
        fetchWithSupabaseSession("/api/proyectos/estados", { cache: "no-store" }),
        fetchWithSupabaseSession("/api/usuarios/empresa-activos", { cache: "no-store" }),
        fetchWithSupabaseSession("/api/proyectos/modulos-catalogo", { cache: "no-store" }),
      ]);
      const j = (await r.json()) as { success?: boolean; data?: { id: string; nombre: string }[] };
      const jUsers = (await rUsers.json()) as { usuarios?: UsuarioActivo[] };
      const jModulos = (await rModulos.json()) as { success?: boolean; data?: ModuloCatalogo[] };
      if (!c && j.success && j.data) setEstados(j.data);
      if (!c) setUsuarios(jUsers.usuarios ?? []);
      if (!c && jModulos.success && jModulos.data) setModulosCatalogo(jModulos.data);
    })();
    return () => {
      c = true;
    };
  }, []);

  const datosDirty = useMemo(() => {
    const cur = JSON.stringify({
      bf: briefForm,
      saas: saasForm,
      responsable_tecnico_id: responsableTecnicoId,
      obs: observaciones,
    });
    return datosSnapshot !== "" && cur !== datosSnapshot;
  }, [briefForm, saasForm, responsableTecnicoId, observaciones, datosSnapshot]);

  useEffect(() => {
    onDirtyChange?.(datosDirty);
  }, [datosDirty, onDirtyChange]);

  async function guardarDatos() {
    const proyecto = data?.proyecto;
    if (!proyecto) return;
    const tipoCodigo = proyecto.proyecto_tipo?.codigo ?? "";
    const briefMerged =
      tipoCodigo === "saas"
        ? applySaasFormToExisting(proyecto.brief_data, saasForm)
        : applyBriefFormToExisting(proyecto.brief_data, briefForm);
    const res = await fetchWithSupabaseSession(`/api/proyectos/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brief_data: briefMerged,
        responsable_tecnico_id: responsableTecnicoId || null,
        observaciones_comerciales: observaciones.trim() === "" ? null : observaciones.trim(),
      }),
    });
    const j = (await res.json()) as { success?: boolean; error?: string };
    if (!res.ok || !j.success) {
      setErr(j.error ?? "No se pudo guardar");
      return;
    }
    await load();
    onProjectUpdated?.();
  }

  async function agregarComentario(e: React.FormEvent) {
    e.preventDefault();
    if (!comTexto.trim()) return;
    const res = await fetchWithSupabaseSession(`/api/proyectos/${projectId}/comentarios`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comentario: comTexto.trim() }),
    });
    const j = (await res.json()) as { success?: boolean; error?: string };
    if (!res.ok || !j.success) {
      setErr(j.error ?? "Error");
      return;
    }
    setComTexto("");
    await load();
    onProjectUpdated?.();
  }

  async function agregarTarea(e: React.FormEvent) {
    e.preventDefault();
    if (!tareaTitulo.trim()) return;
    const res = await fetchWithSupabaseSession(`/api/proyectos/${projectId}/tareas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ titulo: tareaTitulo.trim() }),
    });
    const j = (await res.json()) as { success?: boolean; error?: string };
    if (!res.ok || !j.success) {
      setErr(j.error ?? "Error");
      return;
    }
    setTareaTitulo("");
    await load();
    onProjectUpdated?.();
  }

  async function patchTarea(tareaId: string, patch: Record<string, unknown>) {
    const res = await fetchWithSupabaseSession(`/api/proyectos/${projectId}/tareas/${tareaId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const j = (await res.json()) as { success?: boolean; error?: string };
    if (!res.ok || !j.success) setErr(j.error ?? "Error");
    else {
      await load();
      onProjectUpdated?.();
    }
  }

  async function cambiarEstado(estadoId: string) {
    const res = await fetchWithSupabaseSession(`/api/proyectos/${projectId}/cambiar-estado`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado_id: estadoId }),
    });
    const j = (await res.json()) as { success?: boolean; error?: string };
    if (!res.ok || !j.success) setErr(j.error ?? "Error");
    else {
      await load();
      onProjectUpdated?.();
    }
  }

  const [enviandoCaja, setEnviandoCaja] = useState(false);
  async function enviarACaja() {
    if (enviandoCaja) return;
    setEnviandoCaja(true);
    setErr(null);
    try {
      const res = await fetchWithSupabaseSession(`/api/proyectos/${projectId}/enviar-a-caja`, { method: "POST" });
      const j = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !j.success) {
        setErr(j.error ?? "No se pudo enviar a Caja");
        return;
      }
      await load();
      onProjectUpdated?.();
    } finally {
      setEnviandoCaja(false);
    }
  }

  const slaFmt = useMemo(() => {
    const s = data?.sla as { segundos_interno?: number; segundos_cliente?: number; segundos_pausado?: number } | undefined;
    if (!s) return null;
    const fmt = (sec?: number) =>
      sec == null ? "—" : `${Math.round((sec / 3600) * 10) / 10} h`;
    return {
      interno: fmt(s.segundos_interno),
      cliente: fmt(s.segundos_cliente),
      pausado: fmt(s.segundos_pausado),
    };
  }, [data?.sla]);

  const proyecto = data?.proyecto;
  const codigoTipo = proyecto?.proyecto_tipo?.codigo ?? "";
  const esWeb = codigoTipo === "web";
  const esSaas = codigoTipo === "saas";
  const briefCoerced = coalesceBriefData(proyecto?.brief_data);
  // Pedidos (gastronomía): el resumen muestra datos del pedido en vez de campos web/SaaS.
  const briefRaw: Record<string, unknown> =
    proyecto?.brief_data && typeof proyecto.brief_data === "object" && !Array.isArray(proyecto.brief_data)
      ? (proyecto.brief_data as Record<string, unknown>)
      : {};
  const esPedido = codigoTipo === "pedido";
  const facturacionEstado = getFacturacionEstado((proyecto as { metadata?: unknown } | undefined)?.metadata);
  const ventaIdPedido = (() => {
    const m = asMetadataObject((proyecto as { metadata?: unknown } | undefined)?.metadata);
    return typeof m.venta_id === "string" ? m.venta_id : null;
  })();
  const ventaNumeroPedido = (() => {
    const m = asMetadataObject((proyecto as { metadata?: unknown } | undefined)?.metadata);
    return typeof m.venta_numero === "string" ? m.venta_numero : null;
  })();
  const pedidoModalidad = typeof briefRaw.modalidad === "string" ? briefRaw.modalidad : null;
  const pedidoModalidadLabel =
    pedidoModalidad === "local"
      ? "En local"
      : pedidoModalidad === "delivery"
        ? "Delivery"
        : pedidoModalidad === "carry_out"
          ? "Retiro / Carry out"
          : "—";
  const pedidoMesa = typeof briefRaw.mesa === "string" ? briefRaw.mesa : null;
  const pedidoTelefono = typeof briefRaw.cliente_telefono === "string" ? briefRaw.cliente_telefono : null;
  const pedidoDireccion = typeof briefRaw.direccion_entrega === "string" ? briefRaw.direccion_entrega : null;
  const pedidoControl = typeof briefRaw.numero_control === "string" ? briefRaw.numero_control : null;
  const pedidoObservacion = typeof briefRaw.observacion === "string" ? briefRaw.observacion : null;
  const pedidoItems = Array.isArray(briefRaw.items)
    ? (briefRaw.items as Array<Record<string, unknown>>).map((it) => ({
        nombre: typeof it.producto_nombre === "string" ? it.producto_nombre : "—",
        cantidad: typeof it.cantidad === "number" ? it.cantidad : Number(it.cantidad) || 0,
      }))
    : [];
  const pedidoTotal = Number(proyecto?.monto_vendido ?? 0);
  const fmtGs = (n: number) => "Gs. " + Math.round(n || 0).toLocaleString("es-PY");
  const saasModuloIds = saasForm.modulos_necesarios
    .map((modulo) => modulo.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const updateSaasField = <K extends keyof ProyectoSaasBriefForm>(key: K, value: ProyectoSaasBriefForm[K]) => {
    setSaasForm((prev) => ({ ...prev, [key]: value }));
  };
  const updateSaasModulos = (ids: string[]) => {
    const snapshots: ProyectoModuloSnapshot[] = modulosCatalogo
      .filter((modulo) => ids.includes(modulo.id))
      .map((modulo) => ({ id: modulo.id, slug: modulo.slug, nombre: modulo.nombre }));
    updateSaasField("modulos_necesarios", snapshots);
  };

  if (!projectId) return null;
  if (loading && !data) {
    return <div className="p-6 text-sm text-slate-500">Cargando…</div>;
  }
  if (err && !data) return <div className="p-6 text-sm text-red-600">{err}</div>;
  if (!data || !proyecto) return null;

  const panelCls = "rounded-xl border border-slate-200 bg-white p-4 shadow-sm";
  const labelCls = "text-slate-500";
  const inputCls =
    "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/25";

  return (
    <div
      className={
        variant === "modal"
          ? "flex max-h-[94vh] flex-col p-4 sm:p-6"
          : "mx-auto max-w-5xl space-y-6 p-6"
      }
    >
      {variant === "page" ? (
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/dashboard/proyectos" className="text-sm text-[#3F8E91] hover:text-[#2F6E71] hover:underline">
            ← Kanban
          </Link>
        </div>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
        <div className="min-w-0 flex-1">
          <h1
            id={variant === "modal" ? "proyecto-detalle-titulo" : undefined}
            className="truncate text-xl font-semibold text-slate-900"
          >
            {String(proyecto.titulo ?? "")}
          </h1>
          <p className="text-sm text-slate-500">
            {(proyecto as { proyecto_tipo?: { nombre?: string } }).proyecto_tipo?.nombre ?? "—"} · Avance{" "}
            {data.avance_pct ?? "—"}%
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {esPedido && facturacionEstado === "facturado" && (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-100 px-3 py-2 text-sm font-medium text-emerald-700">
              ✓ Facturado
              {ventaIdPedido && (
                <Link href={`/ventas?venta=${ventaIdPedido}`} className="underline hover:text-emerald-900">
                  {ventaNumeroPedido ?? "Ver venta"}
                </Link>
              )}
            </span>
          )}
          {esPedido && facturacionEstado === "pendiente_caja" && (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-100 px-3 py-2 text-sm font-medium text-amber-700">
              ⏳ Pendiente en Caja
            </span>
          )}
          {esPedido && facturacionEstado === null && (
            <button
              type="button"
              onClick={() => void enviarACaja()}
              disabled={enviandoCaja}
              className="rounded-lg bg-[#4FAEB2] px-3 py-2 text-sm font-medium text-white hover:bg-[#3F8E91] disabled:opacity-50"
            >
              {enviandoCaja ? "Enviando…" : "Enviar a Caja"}
            </button>
          )}
          <select
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
            value={String(proyecto.estado_id ?? "")}
            onChange={(e) => void cambiarEstado(e.target.value)}
          >
            {estados.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre}
              </option>
            ))}
          </select>
          {variant === "modal" ? (
            <button
              type="button"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              onClick={() => onClose?.()}
            >
              Cerrar
            </button>
          ) : (
            <button
              type="button"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              onClick={() => router.push("/dashboard/proyectos")}
            >
              Cerrar
            </button>
          )}
        </div>
      </div>

      {err ? <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{err}</div> : null}

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        {TAB_IDS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === t
                ? "border border-[#4FAEB2]/30 bg-[#E5F4F4] text-[#2F6E71]"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      <div className={variant === "modal" ? "min-h-0 flex-1 overflow-y-auto pr-1" : ""}>
        {tab === "resumen" ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className={panelCls}>
              <h2 className="text-sm font-semibold text-slate-800">Resumen del proyecto</h2>
              <dl className="mt-4 space-y-3 text-sm">
                <div className="flex justify-between gap-3 border-b border-slate-200 pb-2">
                  <dt className={labelCls}>Cliente</dt>
                  <dd className="text-right text-slate-900">{clienteNombre(proyecto)}</dd>
                </div>
                {!esPedido ? (
                  <>
                    <div className="flex justify-between gap-3 border-b border-slate-200 pb-2">
                      <dt className={labelCls}>Vendedor / comercial</dt>
                      <dd className="text-right text-slate-900">
                        {(proyecto as { responsable_comercial?: { nombre?: string } }).responsable_comercial?.nombre ?? "—"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3 border-b border-slate-200 pb-2">
                      <dt className={labelCls}>Técnico responsable</dt>
                      <dd className="text-right text-slate-900">
                        {(proyecto as { responsable_tecnico?: { nombre?: string } }).responsable_tecnico?.nombre ?? "—"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3 border-b border-slate-200 pb-2">
                      <dt className={labelCls}>Fecha prometida</dt>
                      <dd className="text-right text-slate-900">
                        {proyecto.fecha_prometida != null && String(proyecto.fecha_prometida).trim() !== ""
                          ? formatFechaPyFull(String(proyecto.fecha_prometida))
                          : "—"}
                      </dd>
                    </div>
                  </>
                ) : null}
                {esPedido ? (
                  <>
                    <div className="flex justify-between gap-3 border-b border-slate-200 pb-2">
                      <dt className={labelCls}>Modalidad</dt>
                      <dd className="text-right font-medium text-slate-900">{pedidoModalidadLabel}</dd>
                    </div>
                    {pedidoModalidad === "local" && pedidoMesa ? (
                      <div className="flex justify-between gap-3 border-b border-slate-200 pb-2">
                        <dt className={labelCls}>Mesa</dt>
                        <dd className="text-right text-slate-900">{pedidoMesa}</dd>
                      </div>
                    ) : null}
                    {pedidoTelefono ? (
                      <div className="flex justify-between gap-3 border-b border-slate-200 pb-2">
                        <dt className={labelCls}>Teléfono</dt>
                        <dd className="text-right text-slate-900">{pedidoTelefono}</dd>
                      </div>
                    ) : null}
                    {pedidoDireccion ? (
                      <div className="flex justify-between gap-3 border-b border-slate-200 pb-2">
                        <dt className={labelCls}>Dirección de entrega</dt>
                        <dd className="max-w-[60%] text-right text-slate-900">{pedidoDireccion}</dd>
                      </div>
                    ) : null}
                    {pedidoControl ? (
                      <div className="flex justify-between gap-3 border-b border-slate-200 pb-2">
                        <dt className={labelCls}>N° de control</dt>
                        <dd className="text-right tabular-nums text-slate-900">{pedidoControl}</dd>
                      </div>
                    ) : null}
                    {pedidoItems.length > 0 ? (
                      <div className="border-b border-slate-200 pb-2">
                        <dt className={`${labelCls} mb-1`}>Ítems</dt>
                        <ul className="space-y-0.5">
                          {pedidoItems.map((it, idx) => (
                            <li key={idx} className="flex items-baseline gap-1.5 text-slate-900">
                              <span className="font-semibold tabular-nums">{it.cantidad}×</span>
                              <span className="truncate">{it.nombre}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {pedidoObservacion ? (
                      <div className="border-b border-slate-200 pb-2">
                        <dt className={`${labelCls} mb-1`}>Observación</dt>
                        <dd className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[13px] italic text-amber-900">
                          {pedidoObservacion}
                        </dd>
                      </div>
                    ) : null}
                    <div className="flex justify-between gap-3 border-b border-slate-200 pb-2">
                      <dt className={labelCls}>Total</dt>
                      <dd className="text-right text-base font-semibold tabular-nums text-slate-900">{fmtGs(pedidoTotal)}</dd>
                    </div>
                  </>
                ) : esSaas ? (
                  <>
                    <div className="flex justify-between gap-3 border-b border-slate-200 pb-2">
                      <dt className={labelCls}>Empresa SaaS / ERP</dt>
                      <dd className="max-w-[55%] text-right text-slate-900">
                        {saasForm.empresa_nombre.trim() || "—"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3 border-b border-slate-200 pb-2">
                      <dt className={labelCls}>Módulos necesarios</dt>
                      <dd className="max-w-[55%] text-right text-slate-900">
                        {saasForm.modulos_necesarios.length > 0
                          ? saasForm.modulos_necesarios.map((m) => m.nombre).join(", ")
                          : "—"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3 border-b border-slate-200 pb-2">
                      <dt className={labelCls}>WhatsApp contacto</dt>
                      <dd className="max-w-[55%] text-right text-slate-900">
                        {saasForm.whatsapp_contacto.trim() || "—"}
                      </dd>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between gap-3 border-b border-slate-200 pb-2">
                      <dt className={labelCls}>Nombre de la marca</dt>
                      <dd className="max-w-[55%] text-right text-slate-900">
                        {(briefCoerced.marca || "").trim() || "—"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3 border-b border-slate-200 pb-2">
                      <dt className={labelCls}>Dominio a usar</dt>
                      <dd className="max-w-[55%] break-all text-right text-slate-900">
                        {(briefCoerced.dominio_usar || "").trim() || "—"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3 border-b border-slate-200 pb-2">
                      <dt className={labelCls}>Tipo de web</dt>
                      <dd className="max-w-[55%] text-right text-slate-900">
                        {(briefCoerced.tipo_web || "").trim() || "—"}
                      </dd>
                    </div>
                  </>
                )}
                <div className="flex justify-between gap-3">
                  <dt className={labelCls}>Prioridad</dt>
                  <dd className="text-right text-slate-900">{prioridadLabel(proyecto.prioridad)}</dd>
                </div>
              </dl>
            </div>
            <div className={panelCls}>
              <h2 className="text-sm font-semibold text-slate-800">SLA acumulado</h2>
              <dl className="mt-4 space-y-3 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className={labelCls}>Tiempo interno</dt>
                  <dd className="text-slate-900">{slaFmt?.interno}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className={labelCls}>Espera cliente</dt>
                  <dd className="text-slate-900">{slaFmt?.cliente}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className={labelCls}>Pausado</dt>
                  <dd className="text-slate-900">{slaFmt?.pausado}</dd>
                </div>
              </dl>
            </div>
          </div>
        ) : null}

        {tab === "datos" ? (
          <div className={`space-y-4 ${panelCls}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-800">Datos del proyecto</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Editá los campos guardados en el proyecto. Los datos previos se conservan al guardar.
                </p>
              </div>
              <button
                type="button"
                className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-xs font-medium text-white shadow-sm transition-colors hover:bg-[#3F8E91] disabled:opacity-50"
                disabled={!datosDirty}
                onClick={() => void guardarDatos()}
              >
                Guardar datos
              </button>
            </div>

            {esWeb ? (
              <p className="text-xs text-slate-500">
                Tipo &quot;Proyecto Web&quot;: campos adicionales del brief comercial.
              </p>
            ) : null}
            {esSaas ? (
              <p className="text-xs text-slate-500">
                Tipo &quot;SaaS / ERP&quot;: snapshot de módulos requeridos, sin activar permisos ni módulos reales.
              </p>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className={labelCls}>Técnico responsable</span>
                <select
                  className={inputCls}
                  value={responsableTecnicoId}
                  onChange={(e) => setResponsableTecnicoId(e.target.value)}
                >
                  <option value="">—</option>
                  {usuarios.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nombre || u.email || u.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </label>
              {esWeb ? (
                <label className="block text-sm sm:col-span-2">
                  <span className={labelCls}>Observaciones comerciales</span>
                  <textarea
                    className={`${inputCls} min-h-[88px]`}
                    rows={3}
                    value={observaciones}
                    onChange={(e) => setObservaciones(e.target.value)}
                    placeholder="Detalle adicional negociado con el cliente…"
                  />
                </label>
              ) : null}
            </div>

            {esWeb ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {PROYECTO_DATOS_BRIEF_FIELDS.map((f) =>
                  f.kind === "checkbox" ? (
                    <label key={f.key} className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        className="rounded border-slate-300 bg-white accent-[#4FAEB2]"
                        checked={briefForm[f.key] === "1"}
                        onChange={(e) =>
                          setBriefForm((b) => ({ ...b, [f.key]: e.target.checked ? "1" : "" }))
                        }
                      />
                      {f.label}
                    </label>
                  ) : (
                    <label key={f.key} className={`block text-sm ${f.key === "secciones" ? "sm:col-span-2" : ""}`}>
                      <span className={labelCls}>{f.label}</span>
                      <input
                        className={inputCls}
                        placeholder={f.placeholder}
                        value={briefForm[f.key] ?? ""}
                        onChange={(e) => setBriefForm((b) => ({ ...b, [f.key]: e.target.value }))}
                      />
                    </label>
                  )
                )}
              </div>
            ) : null}

            {esSaas ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className={labelCls}>Nombre de la empresa</span>
                  <input
                    className={inputCls}
                    value={saasForm.empresa_nombre}
                    onChange={(e) => updateSaasField("empresa_nombre", e.target.value)}
                  />
                </label>
                <label className="block text-sm">
                  <span className={labelCls}>WhatsApp contacto</span>
                  <input
                    className={inputCls}
                    placeholder="+595..."
                    value={saasForm.whatsapp_contacto}
                    onChange={(e) => updateSaasField("whatsapp_contacto", e.target.value)}
                  />
                </label>
                <div className="block text-sm sm:col-span-2">
                  <span className={labelCls}>Módulos necesarios</span>
                  <div className="mt-1">
                    <ProyectoModuloSelector
                      modulos={modulosCatalogo}
                      selectedIds={saasModuloIds}
                      onChange={updateSaasModulos}
                      variant="light"
                    />
                  </div>
                </div>
                <label className="block text-sm sm:col-span-2">
                  <span className={labelCls}>Observaciones</span>
                  <textarea
                    className={`${inputCls} min-h-[88px]`}
                    rows={3}
                    value={saasForm.observaciones}
                    onChange={(e) => updateSaasField("observaciones", e.target.value)}
                  />
                </label>
              </div>
            ) : null}

            {Object.keys(briefCoerced).length === 0 &&
            !observaciones.trim() ? (
              <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                Todavía no hay datos cargados. Completá el formulario y guardá.
              </p>
            ) : null}
          </div>
        ) : null}

        {tab === "tareas" ? (
          <div className={`space-y-4 ${panelCls}`}>
            <form onSubmit={agregarTarea} className="flex flex-wrap gap-2">
              <input
                className={`min-w-[200px] flex-1 ${inputCls}`}
                placeholder="Nueva tarea"
                value={tareaTitulo}
                onChange={(e) => setTareaTitulo(e.target.value)}
              />
              <button
                type="submit"
                className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#3F8E91]"
              >
                Agregar
              </button>
            </form>
            <ul className="divide-y divide-slate-200">
              {(data.tareas ?? []).map((t) => {
                const tid = String(t.id ?? "");
                const estado = String(t.estado ?? "");
                return (
                  <li key={tid} className="flex flex-wrap items-center gap-2 py-3 text-sm">
                    <span className="flex-1 font-medium text-slate-900">{String(t.titulo ?? "")}</span>
                    <select
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                      value={estado}
                      onChange={(e) => void patchTarea(tid, { estado: e.target.value })}
                    >
                      <option value="pendiente">pendiente</option>
                      <option value="en_proceso">en_proceso</option>
                      <option value="completada">completada</option>
                      <option value="bloqueada">bloqueada</option>
                    </select>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {tab === "comentarios" ? (
          <div className={`space-y-4 ${panelCls}`}>
            <form onSubmit={agregarComentario} className="space-y-2">
              <textarea
                className={`${inputCls} min-h-[80px]`}
                rows={3}
                placeholder="Comentario interno"
                value={comTexto}
                onChange={(e) => setComTexto(e.target.value)}
              />
              <button
                type="submit"
                className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#3F8E91]"
              >
                Publicar
              </button>
            </form>
            <ul className="space-y-3">
              {(data.comentarios ?? []).map((c) => (
                <li key={String(c.id)} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                  <div className="text-xs text-slate-500">
                    {String((c as { usuario_nombre?: string }).usuario_nombre ?? "")} ·{" "}
                    {formatFechaPyFull(String(c.created_at ?? ""))}
                  </div>
                  <div className="mt-1 text-slate-700">{String(c.comentario ?? "")}</div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {tab === "archivos" ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
            <p className="font-medium text-slate-700">Archivos del proyecto</p>
            <p className="mt-2 text-xs">
              Registro en base de datos listo; subida a almacenamiento en una siguiente iteración.
            </p>
            <ul className="mt-4 space-y-2">
              {(data.archivos ?? []).length === 0 ? (
                <li className="text-slate-500">Sin archivos registrados.</li>
              ) : (
                (data.archivos ?? []).map((a) => (
                  <li key={String(a.id)} className="text-slate-600">
                    {String(a.nombre ?? "")}{" "}
                    <span className="text-xs text-slate-500">{formatFechaPyFull(String(a.created_at ?? ""))}</span>
                  </li>
                ))
              )}
            </ul>
          </div>
        ) : null}

        {tab === "historial" ? (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Estado anterior</th>
                    <th className="px-3 py-2">Estado nuevo</th>
                    <th className="px-3 py-2">Tipo SLA</th>
                    <th className="px-3 py-2">Entrada</th>
                    <th className="px-3 py-2">Salida</th>
                    <th className="px-3 py-2">Duración</th>
                    <th className="px-3 py-2">Usuario</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {(data.historial ?? []).map((h) => {
                    const hr = h as Record<string, unknown>;
                    const ant =
                      (hr.estado_anterior_nombre as string | undefined) ??
                      (hr.estado_anterior_id ? String(hr.estado_anterior_id) : "—");
                    const nue =
                      (hr.estado_nuevo_nombre as string | undefined) ??
                      String(hr.estado_nuevo_id ?? "—");
                    const slaL =
                      (hr.tipo_sla_label as string | undefined) ??
                      String(hr.tipo_sla_snapshot ?? "—");
                    const usr = (hr.usuario_cambio_label as string | undefined) ?? "No registrado";
                    const dur =
                      (hr.duration_label as string | undefined) ??
                      (hr.duration_seconds != null ? String(hr.duration_seconds) + " s" : "—");
                    return (
                      <tr key={String(h.id)} className="text-slate-700">
                        <td className="px-3 py-2 text-xs">{ant}</td>
                        <td className="px-3 py-2 text-xs font-medium">{nue}</td>
                        <td className="px-3 py-2 text-xs text-slate-600">{slaL}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-slate-600">
                          {formatFechaPyFull(String(h.entered_at ?? ""))}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-slate-600">
                          {h.exited_at ? formatFechaPyFull(String(h.exited_at)) : "—"}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-600">{dur}</td>
                        <td className="max-w-[140px] truncate px-3 py-2 text-xs text-slate-500" title={usr}>
                          {usr}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
