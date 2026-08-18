"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { GlobalConfigSubpageShell } from "@/components/config/GlobalConfigSubpageShell";
import {
  ConfigFormCard,
  ConfigHelpText,
  ConfigMetricCard,
  ConfigSectionTitle,
  F_INPUT,
  F_LABEL,
  F_SELECT,
} from "@/components/config/global-config-primitives";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";

type ProyectoTipoSla = "interno" | "cliente" | "pausado" | "final";

type ProyectoEstadoConfigItem = {
  id: string;
  empresa_id: string;
  codigo: string;
  nombre: string;
  color: string;
  sort_order: number;
  activo: boolean;
  es_estado_inicial: boolean;
  es_estado_final: boolean;
  cuenta_sla: boolean;
  tipo_sla: ProyectoTipoSla;
  sla_horas_objetivo: number | null;
  proyectos_activos_count: number;
};

type EstadoDraft = Pick<
  ProyectoEstadoConfigItem,
  | "nombre"
  | "color"
  | "sort_order"
  | "activo"
  | "es_estado_inicial"
  | "es_estado_final"
  | "cuenta_sla"
  | "tipo_sla"
  | "sla_horas_objetivo"
>;

type ProyectoPrioridadConfigItem = {
  id: string;
  empresa_id: string;
  codigo: "baja" | "normal" | "alta" | "urgente";
  nombre: string;
  color: string | null;
  bg_color: string | null;
  text_color: string | null;
  border_color: string | null;
  sort_order: number;
  activo: boolean;
};

type PrioridadDraft = Pick<
  ProyectoPrioridadConfigItem,
  "nombre" | "bg_color" | "sort_order" | "activo"
>;

type EstadosConfigResponse = {
  estados: ProyectoEstadoConfigItem[];
  meta: {
    can_edit: boolean;
    role?: string | null;
    source_table: "proyecto_estados";
  };
};

type PrioridadesConfigResponse = {
  prioridades: ProyectoPrioridadConfigItem[];
  meta: {
    can_edit: boolean;
    role?: string | null;
    source_table: "proyecto_prioridades_config";
    source: "db" | "fallback";
  };
};

type ApiEnvelope<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

const EMPTY_NEW_COLUMN: EstadoDraft & { codigo: string } = {
  codigo: "",
  nombre: "",
  color: "#64748b",
  sort_order: 0,
  activo: true,
  es_estado_inicial: false,
  es_estado_final: false,
  cuenta_sla: true,
  tipo_sla: "interno",
  sla_horas_objetivo: null,
};

const SLA_OPTIONS: Array<{ value: ProyectoTipoSla; label: string }> = [
  { value: "interno", label: "Interno" },
  { value: "cliente", label: "Cliente" },
  { value: "pausado", label: "Pausado" },
  { value: "final", label: "Final" },
];

function toDraft(estado: ProyectoEstadoConfigItem): EstadoDraft {
  return {
    nombre: estado.nombre,
    color: estado.color,
    sort_order: estado.sort_order,
    activo: estado.activo,
    es_estado_inicial: estado.es_estado_inicial,
    es_estado_final: estado.es_estado_final,
    cuenta_sla: estado.cuenta_sla,
    tipo_sla: estado.tipo_sla,
    sla_horas_objetivo: estado.sla_horas_objetivo,
  };
}

function toPrioridadDraft(prioridad: ProyectoPrioridadConfigItem): PrioridadDraft {
  return {
    nombre: prioridad.nombre,
    bg_color: prioridad.bg_color ?? prioridad.color ?? prioridadFallbackCardColor(prioridad.codigo),
    sort_order: prioridad.sort_order,
    activo: prioridad.activo,
  };
}

function readError(json: ApiEnvelope<unknown>, fallback: string): string {
  return json.error || fallback;
}

function prioridadFallbackCardColor(codigo: ProyectoPrioridadConfigItem["codigo"]): string {
  if (codigo === "urgente") return "#fecaca";
  if (codigo === "alta") return "#fed7aa";
  if (codigo === "normal") return "#fde68a";
  return "#e2e8f0";
}

function isHexColor(value: string | null | undefined): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

function readableTextColor(hex: string | null | undefined): string {
  if (!isHexColor(hex)) return "#111827";
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance < 0.52 ? "#ffffff" : "#111827";
}

export default function ConfiguracionProyectosPage() {
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [estados, setEstados] = useState<ProyectoEstadoConfigItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, EstadoDraft>>({});
  const [prioridades, setPrioridades] = useState<ProyectoPrioridadConfigItem[]>([]);
  const [prioridadDrafts, setPrioridadDrafts] = useState<Record<string, PrioridadDraft>>({});
  const [prioridadesLoading, setPrioridadesLoading] = useState(true);
  const [savingPriorityId, setSavingPriorityId] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [newColumn, setNewColumn] = useState(EMPTY_NEW_COLUMN);

  const activeInitialCount = useMemo(
    () => estados.filter((estado) => estado.activo && estado.es_estado_inicial).length,
    [estados]
  );

  const activeCount = useMemo(() => estados.filter((estado) => estado.activo).length, [estados]);

  const loadEstados = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const response = await apiFetch("/api/configuracion/proyectos/estados", { cache: "no-store" });
      const json = (await response.json()) as ApiEnvelope<EstadosConfigResponse>;
      if (!response.ok || !json.success || !json.data) {
        throw new Error(readError(json, "No se pudieron cargar las columnas Kanban"));
      }

      setEstados(json.data.estados);
      setCanEdit(json.data.meta.can_edit);
      setDrafts(
        Object.fromEntries(json.data.estados.map((estado) => [estado.id, toDraft(estado)]))
      );
    } catch (e) {
      setMessage({
        type: "error",
        text: e instanceof Error ? e.message : "No se pudieron cargar las columnas Kanban",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPrioridades = useCallback(async () => {
    setPrioridadesLoading(true);
    try {
      const response = await apiFetch("/api/configuracion/proyectos/prioridades", { cache: "no-store" });
      const json = (await response.json()) as ApiEnvelope<PrioridadesConfigResponse>;
      if (!response.ok || !json.success || !json.data) {
        throw new Error(readError(json, "No se pudieron cargar las prioridades"));
      }

      setPrioridades(json.data.prioridades);
      setCanEdit(json.data.meta.can_edit);
      setPrioridadDrafts(
        Object.fromEntries(json.data.prioridades.map((prioridad) => [prioridad.id, toPrioridadDraft(prioridad)]))
      );
    } catch (e) {
      setMessage({
        type: "error",
        text: e instanceof Error ? e.message : "No se pudieron cargar las prioridades",
      });
    } finally {
      setPrioridadesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEstados();
    void loadPrioridades();
  }, [loadEstados, loadPrioridades]);

  const updateDraft = <K extends keyof EstadoDraft>(id: string, key: K, value: EstadoDraft[K]) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] ?? EMPTY_NEW_COLUMN),
        [key]: value,
      },
    }));
  };

  const updatePrioridadDraft = <K extends keyof PrioridadDraft>(id: string, key: K, value: PrioridadDraft[K]) => {
    setPrioridadDrafts((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] ?? {
          nombre: "",
          bg_color: null,
          sort_order: 0,
          activo: true,
        }),
        [key]: value,
      },
    }));
  };

  const saveEstado = async (estado: ProyectoEstadoConfigItem) => {
    const draft = drafts[estado.id];
    if (!draft) return;
    setSavingId(estado.id);
    setMessage(null);
    try {
      const response = await apiFetch(`/api/configuracion/proyectos/estados/${estado.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const json = (await response.json()) as ApiEnvelope<{ estado: ProyectoEstadoConfigItem }>;
      if (!response.ok || !json.success) {
        throw new Error(readError(json, "No se pudo guardar la columna"));
      }

      setMessage({ type: "ok", text: "Columna Kanban guardada. El tablero de Proyectos verá el cambio al refrescar." });
      await loadEstados();
    } catch (e) {
      setMessage({
        type: "error",
        text: e instanceof Error ? e.message : "No se pudo guardar la columna",
      });
    } finally {
      setSavingId(null);
    }
  };

  const createEstado = async () => {
    setCreating(true);
    setMessage(null);
    try {
      const response = await apiFetch("/api/configuracion/proyectos/estados", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newColumn),
      });
      const json = (await response.json()) as ApiEnvelope<{ estado: ProyectoEstadoConfigItem }>;
      if (!response.ok || !json.success) {
        throw new Error(readError(json, "No se pudo crear la columna"));
      }

      setNewColumn(EMPTY_NEW_COLUMN);
      setMessage({ type: "ok", text: "Columna Kanban creada correctamente." });
      await loadEstados();
    } catch (e) {
      setMessage({
        type: "error",
        text: e instanceof Error ? e.message : "No se pudo crear la columna",
      });
    } finally {
      setCreating(false);
    }
  };

  const savePrioridad = async (prioridad: ProyectoPrioridadConfigItem) => {
    const draft = prioridadDrafts[prioridad.id];
    if (!draft) return;
    if (draft.bg_color && !isHexColor(draft.bg_color)) {
      setMessage({ type: "error", text: "Color de tarjeta debe tener formato hexadecimal, por ejemplo #FDE68A." });
      return;
    }
    const cardColor = isHexColor(draft.bg_color) ? draft.bg_color : prioridadFallbackCardColor(prioridad.codigo);
    const payload = {
      ...draft,
      bg_color: cardColor,
      color: cardColor,
      border_color: cardColor,
      text_color: readableTextColor(cardColor),
    };
    setSavingPriorityId(prioridad.id);
    setMessage(null);
    try {
      const response = await apiFetch(`/api/configuracion/proyectos/prioridades/${prioridad.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await response.json()) as ApiEnvelope<{ prioridad: ProyectoPrioridadConfigItem }>;
      if (!response.ok || !json.success) {
        throw new Error(readError(json, "No se pudo guardar la prioridad"));
      }

      setMessage({ type: "ok", text: "Prioridad guardada. El Kanban verá el cambio al refrescar." });
      await loadPrioridades();
    } catch (e) {
      setMessage({
        type: "error",
        text: e instanceof Error ? e.message : "No se pudo guardar la prioridad",
      });
    } finally {
      setSavingPriorityId(null);
    }
  };

  return (
    <GlobalConfigSubpageShell
      title="Configuración Proyectos"
      description="Columnas del tablero, estados y configuración visual del módulo Proyectos."
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <ConfigMetricCard label="Tabla origen" value="proyecto_estados" sub="Una configuración por empresa" />
        <ConfigMetricCard label="Columnas activas" value={activeCount} sub="Visibles en el Kanban" />
        <ConfigMetricCard label="Inicial activa" value={activeInitialCount} sub="Debe existir exactamente una" />
      </div>

      {message ? (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm ${
            message.type === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-800"
          }`}
        >
          {message.text}
        </div>
      ) : null}

      {!canEdit ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Estás viendo esta configuración en modo lectura. Solo admin, administrador o super_admin pueden editar.
        </div>
      ) : null}

      <ConfigFormCard>
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <ConfigSectionTitle>Columnas Kanban</ConfigSectionTitle>
            <p className="max-w-2xl text-sm text-slate-600">
              Estos estados alimentan directamente las columnas del tablero de Proyectos. El código técnico se conserva
              como referencia interna y no se modifica desde esta pantalla.
            </p>
            <ConfigHelpText>
              Desactivá una columna si no la usás. Queda oculta en el tablero operativo y no se elimina el historial.
            </ConfigHelpText>
          </div>
          <button
            type="button"
            onClick={() => void loadEstados()}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Recargar
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-slate-500">Cargando columnas...</p>
        ) : estados.length === 0 ? (
          <p className="text-sm text-slate-500">No hay columnas configuradas para esta empresa.</p>
        ) : (
          <div className="space-y-4">
            {estados.map((estado) => {
              const draft = drafts[estado.id] ?? toDraft(estado);
              const blocksDeactivation = estado.proyectos_activos_count > 0 && draft.activo === false;
              const blocksInitialRemoval =
                estado.activo &&
                estado.es_estado_inicial &&
                activeInitialCount === 1 &&
                (!draft.activo || !draft.es_estado_inicial);

              return (
                <div key={estado.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <span
                        className="mt-1 h-5 w-5 shrink-0 rounded-full border border-white shadow-sm"
                        style={{ backgroundColor: draft.color || "#64748b" }}
                        aria-hidden
                      />
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-bold text-slate-900">{estado.nombre}</p>
                          <EstadoVisibilityBadge activo={draft.activo} />
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500">
                          Código: <span className="font-mono">{estado.codigo}</span> · Proyectos activos:{" "}
                          {estado.proyectos_activos_count}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={!canEdit || savingId === estado.id}
                      onClick={() => void saveEstado(estado)}
                      className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {savingId === estado.id ? "Guardando..." : "Guardar"}
                    </button>
                  </div>

                  <div className="grid gap-4 md:grid-cols-4">
                    <label>
                      <span className={F_LABEL}>Nombre</span>
                      <input
                        className={F_INPUT}
                        value={draft.nombre}
                        disabled={!canEdit}
                        onChange={(e) => updateDraft(estado.id, "nombre", e.target.value)}
                      />
                    </label>
                    <label>
                      <span className={F_LABEL}>Color</span>
                      <div className="flex gap-2">
                        <input
                          type="color"
                          className="h-10 w-12 rounded-lg border border-slate-200 bg-white p-1"
                          value={draft.color}
                          disabled={!canEdit}
                          onChange={(e) => updateDraft(estado.id, "color", e.target.value)}
                        />
                        <input
                          className={F_INPUT}
                          value={draft.color}
                          disabled={!canEdit}
                          onChange={(e) => updateDraft(estado.id, "color", e.target.value)}
                        />
                      </div>
                    </label>
                    <label>
                      <span className={F_LABEL}>Orden</span>
                      <input
                        type="number"
                        className={F_INPUT}
                        value={draft.sort_order}
                        disabled={!canEdit}
                        onChange={(e) => updateDraft(estado.id, "sort_order", Number(e.target.value))}
                      />
                    </label>
                    <label>
                      <span className={F_LABEL}>Tipo SLA</span>
                      <select
                        className={F_SELECT}
                        value={draft.tipo_sla}
                        disabled={!canEdit}
                        onChange={(e) => updateDraft(estado.id, "tipo_sla", e.target.value as ProyectoTipoSla)}
                      >
                        {SLA_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span className={F_LABEL}>Horas objetivo SLA</span>
                      <input
                        type="number"
                        min={0}
                        className={F_INPUT}
                        value={draft.sla_horas_objetivo ?? ""}
                        disabled={!canEdit}
                        onChange={(e) =>
                          updateDraft(
                            estado.id,
                            "sla_horas_objetivo",
                            e.target.value === "" ? null : Number(e.target.value)
                          )
                        }
                      />
                    </label>
                    <EstadoVisibilitySwitch
                      checked={draft.activo}
                      disabled={!canEdit}
                      blocked={estado.proyectos_activos_count > 0 && draft.activo === false}
                      onChange={(value) => updateDraft(estado.id, "activo", value)}
                    />
                    <ToggleField
                      label="Estado inicial"
                      checked={draft.es_estado_inicial}
                      disabled={!canEdit}
                      onChange={(value) => updateDraft(estado.id, "es_estado_inicial", value)}
                    />
                    <ToggleField
                      label="Estado final"
                      checked={draft.es_estado_final}
                      disabled={!canEdit}
                      onChange={(value) => updateDraft(estado.id, "es_estado_final", value)}
                    />
                    <ToggleField
                      label="Cuenta SLA"
                      checked={draft.cuenta_sla}
                      disabled={!canEdit}
                      onChange={(value) => updateDraft(estado.id, "cuenta_sla", value)}
                    />
                  </div>

                  {blocksDeactivation ? (
                    <p className="mt-3 text-xs font-semibold text-amber-700">
                      Este estado tiene proyectos activos. Mové esos proyectos a otra columna antes de desactivarlo.
                    </p>
                  ) : null}
                  {blocksInitialRemoval ? (
                    <p className="mt-3 text-xs font-semibold text-amber-700">
                      Debe quedar al menos una columna inicial activa.
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        {canEdit ? (
          <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-4">
            <h3 className="text-sm font-bold text-slate-900">Crear columna</h3>
            <ConfigHelpText>
              El código técnico se define solo al crear. No uses un código existente y evitá cambiarlo luego por SQL.
            </ConfigHelpText>
            <div className="mt-4 grid gap-4 md:grid-cols-4">
              <label>
                <span className={F_LABEL}>Código</span>
                <input
                  className={F_INPUT}
                  placeholder="revision_tecnica"
                  value={newColumn.codigo}
                  onChange={(e) => setNewColumn((prev) => ({ ...prev, codigo: e.target.value }))}
                />
              </label>
              <label>
                <span className={F_LABEL}>Nombre</span>
                <input
                  className={F_INPUT}
                  placeholder="Revisión técnica"
                  value={newColumn.nombre}
                  onChange={(e) => setNewColumn((prev) => ({ ...prev, nombre: e.target.value }))}
                />
              </label>
              <label>
                <span className={F_LABEL}>Color</span>
                <input
                  type="color"
                  className="h-10 w-12 rounded-lg border border-slate-200 bg-white p-1"
                  value={newColumn.color}
                  onChange={(e) => setNewColumn((prev) => ({ ...prev, color: e.target.value }))}
                />
              </label>
              <label>
                <span className={F_LABEL}>Orden</span>
                <input
                  type="number"
                  className={F_INPUT}
                  value={newColumn.sort_order}
                  onChange={(e) => setNewColumn((prev) => ({ ...prev, sort_order: Number(e.target.value) }))}
                />
              </label>
              <label>
                <span className={F_LABEL}>Tipo SLA</span>
                <select
                  className={F_SELECT}
                  value={newColumn.tipo_sla}
                  onChange={(e) =>
                    setNewColumn((prev) => ({ ...prev, tipo_sla: e.target.value as ProyectoTipoSla }))
                  }
                >
                  {SLA_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <ToggleField
                label="Estado visible en el tablero"
                checked={newColumn.activo}
                onChange={(value) => setNewColumn((prev) => ({ ...prev, activo: value }))}
              />
              <ToggleField
                label="Estado inicial"
                checked={newColumn.es_estado_inicial}
                onChange={(value) => setNewColumn((prev) => ({ ...prev, es_estado_inicial: value }))}
              />
              <ToggleField
                label="Estado final"
                checked={newColumn.es_estado_final}
                onChange={(value) => setNewColumn((prev) => ({ ...prev, es_estado_final: value }))}
              />
            </div>
            <button
              type="button"
              disabled={creating}
              onClick={() => void createEstado()}
              className="mt-4 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creating ? "Creando..." : "Crear columna"}
            </button>
          </div>
        ) : null}
      </ConfigFormCard>

      <ConfigFormCard>
        <ConfigSectionTitle>Prioridades y colores</ConfigSectionTitle>
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <p className="max-w-2xl text-sm text-slate-600">
            Configurá la etiqueta visible y el color de fondo de las tarjetas del Kanban. El código interno se mantiene
            fijo para respetar <span className="font-mono">proyectos.prioridad</span>.
          </p>
          <button
            type="button"
            onClick={() => void loadPrioridades()}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Recargar
          </button>
        </div>

        {prioridadesLoading ? (
          <p className="text-sm text-slate-500">Cargando prioridades...</p>
        ) : prioridades.length === 0 ? (
          <p className="text-sm text-slate-500">No hay prioridades configuradas para esta empresa.</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {prioridades.map((prioridad) => {
              const draft = prioridadDrafts[prioridad.id] ?? toPrioridadDraft(prioridad);
              return (
                <div key={prioridad.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-slate-900">{prioridad.nombre}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        Código interno: <span className="font-mono">{prioridad.codigo}</span>
                      </p>
                    </div>
                    <div
                      className="min-w-[180px] rounded-xl border p-3 shadow-sm"
                      style={{
                        backgroundColor: draft.bg_color ?? prioridadFallbackCardColor(prioridad.codigo),
                        borderColor: draft.bg_color ?? prioridadFallbackCardColor(prioridad.codigo),
                        color: readableTextColor(draft.bg_color ?? prioridadFallbackCardColor(prioridad.codigo)),
                      }}
                    >
                      <p className="text-xs font-bold">{draft.nombre || prioridad.codigo}</p>
                      <p className="mt-1 text-[11px] opacity-80">Preview de card</p>
                    </div>
                  </div>
                  <ConfigHelpText>
                    Este color se usará como fondo de las tarjetas con esta prioridad.
                  </ConfigHelpText>

                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <label>
                      <span className={F_LABEL}>Nombre visible</span>
                      <input
                        className={F_INPUT}
                        value={draft.nombre}
                        disabled={!canEdit}
                        onChange={(e) => updatePrioridadDraft(prioridad.id, "nombre", e.target.value)}
                      />
                    </label>
                    <label>
                      <span className={F_LABEL}>Orden</span>
                      <input
                        type="number"
                        className={F_INPUT}
                        value={draft.sort_order}
                        disabled={!canEdit}
                        onChange={(e) => updatePrioridadDraft(prioridad.id, "sort_order", Number(e.target.value))}
                      />
                    </label>
                    <ColorField
                      label="Color de tarjeta"
                      value={draft.bg_color}
                      disabled={!canEdit}
                      onChange={(value) => updatePrioridadDraft(prioridad.id, "bg_color", value)}
                    />
                    <ToggleField
                      label="Activo"
                      checked={draft.activo}
                      disabled={!canEdit}
                      onChange={(value) => updatePrioridadDraft(prioridad.id, "activo", value)}
                    />
                  </div>

                  <button
                    type="button"
                    disabled={!canEdit || savingPriorityId === prioridad.id}
                    onClick={() => void savePrioridad(prioridad)}
                    className="mt-4 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {savingPriorityId === prioridad.id ? "Guardando..." : "Guardar prioridad"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </ConfigFormCard>
    </GlobalConfigSubpageShell>
  );
}

function ToggleField({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-slate-300 text-slate-900"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function EstadoVisibilityBadge({ activo }: { activo: boolean }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
        activo
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-slate-200 bg-slate-100 text-slate-600"
      }`}
    >
      {activo ? "Activo" : "Inactivo"}
    </span>
  );
}

function EstadoVisibilitySwitch({
  checked,
  disabled,
  blocked,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  blocked?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-800">Estado visible en el tablero</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {checked ? "Activo" : "Oculto / no usado"} · no elimina el historial.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          disabled={disabled}
          onClick={() => onChange(!checked)}
          className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            checked ? "border-emerald-500 bg-emerald-500" : "border-slate-300 bg-slate-200"
          }`}
        >
          <span
            className={`mt-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
              checked ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>
      {blocked ? (
        <p className="mt-2 text-xs font-semibold text-amber-700">
          Este estado tiene proyectos activos. Mové esos proyectos a otra columna antes de desactivarlo.
        </p>
      ) : null}
    </div>
  );
}

function ColorField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string | null;
  disabled?: boolean;
  onChange: (value: string | null) => void;
}) {
  const safeValue = value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#64748b";
  return (
    <label>
      <span className={F_LABEL}>{label}</span>
      <div className="flex gap-2">
        <input
          type="color"
          className="h-10 w-12 rounded-lg border border-slate-200 bg-white p-1"
          value={safeValue}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          className={F_INPUT}
          value={value ?? ""}
          placeholder="#64748b"
          disabled={disabled}
          onChange={(e) => onChange(e.target.value.trim() === "" ? null : e.target.value)}
        />
      </div>
    </label>
  );
}
