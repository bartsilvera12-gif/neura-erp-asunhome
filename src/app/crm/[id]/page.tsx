"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { addNota, deleteProspecto, getProspecto, moveProspecto, updateProspecto } from "@/lib/crm/storage";
import { getEtapas, getEtapaClasses } from "@/lib/crm/etapas";
import { getPlanes } from "@/lib/planes/storage";
import PlanSelector from "@/components/crm/PlanSelector";
import type { EtapaCrm } from "@/lib/crm/etapas";
import type { Nota, Prospecto } from "@/lib/crm/types";
import type { Plan } from "@/lib/planes/types";
import { getBrowserSupabaseForEmpresaData } from "@/lib/supabase/browser-data-client";

// ── Estilos ────────────────────────────────────────────────────────────────────

const inputClass =
  "w-full border border-gray-300 rounded-lg px-4 py-3 outline-none focus:border-gray-500 transition-colors text-sm";
const labelClass = "block text-sm font-medium text-gray-700 mb-1.5";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4">
      {children}
    </p>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatFecha(iso: string) {
  try {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return "";
  }
}

function originLabel(origen?: Prospecto["origen_creacion"]): string {
  switch (origen) {
    case "manual":
      return "Manual";
    case "whatsapp":
      return "WhatsApp";
    case "formulario_web":
      return "Formulario web";
    case "referido":
      return "Referido";
    case "campaña_meta":
      return "Campaña Meta";
    case "automatizacion":
      return "Automatización";
    case "otro":
      return "Otro";
    default:
      return "-";
  }
}

// ── Componente ────────────────────────────────────────────────────────────────

export default function EditProspectoPage() {
  const params = useParams();
  const router = useRouter();
  if (!params) return null;
  const id = params.id as string;

  const [prospecto, setProspecto] = useState<Prospecto | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [cargando, setCargando] = useState(true);

  const [form, setForm] = useState({
    empresa:               "",
    contacto:              "",
    email:                 "",
    telefono:              "",
    planIds:               [] as string[],
    proxima_accion:        "",
    fecha_proxima_accion:  "",
    creado_por:            "",
    responsable:           "",
    observaciones:         "",
  });

  const [nuevaNota,        setNuevaNota]        = useState("");
  const [guardandoNota,    setGuardandoNota]    = useState(false);
  const notaInputRef = useRef<HTMLTextAreaElement>(null);

  const [errorForm,         setErrorForm]         = useState<string | null>(null);
  const [confirmarEliminar, setConfirmarEliminar] = useState(false);
  const [planes,            setPlanes]            = useState<Plan[]>([]);
  const [etapas,            setEtapas]            = useState<EtapaCrm[]>([]);
  const [cargandoPlanes,    setCargandoPlanes]    = useState(true);
  const [conversationId,  setConversationId]   = useState<string | null>(null);

  useEffect(() => {
    getEtapas().then(setEtapas);
  }, []);

  useEffect(() => {
    getPlanes()
      .then(setPlanes)
      .catch(() => setPlanes([]))
      .finally(() => setCargandoPlanes(false));
  }, []);

  useEffect(() => {
    if (!prospecto || planes.length === 0) return;
    const nombres = prospecto.servicio.split(",").map((s) => s.trim()).filter(Boolean);
    const ids = nombres
      .map((n) => planes.find((p) => p.nombre === n)?.id)
      .filter((id): id is string => Boolean(id));
    setForm((prev) => ({ ...prev, planIds: ids }));
  }, [prospecto?.id, prospecto?.servicio, planes]);

  useEffect(() => {
    async function loadConversationId() {
      if (!prospecto) {
        setConversationId(null);
        return;
      }
      try {
        const sb = await getBrowserSupabaseForEmpresaData();
        const { data: chatContact, error: cErr } = await sb
          .from("chat_contacts")
          .select("id")
          .eq("crm_prospecto_id", prospecto.id)
          .maybeSingle();
        if (cErr) {
          setConversationId(null);
          return;
        }

        const contactId = (chatContact?.id as string | undefined) ?? undefined;
        if (!contactId) {
          setConversationId(null);
          return;
        }

        const { data: conv, error: convErr } = await sb
          .from("chat_conversations")
          .select("id")
          .eq("contact_id", contactId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (convErr) {
          setConversationId(null);
          return;
        }
        setConversationId((conv?.id as string | undefined) ?? null);
      } catch {
        setConversationId(null);
      }
    }

    void loadConversationId();
  }, [prospecto?.id]);

  const cargar = useCallback(async () => {
    setCargando(true);
    setNotFound(false);
    try {
      const p = await getProspecto(id);
      if (!p) {
        setProspecto(null);
        setNotFound(true);
        return;
      }
      setProspecto(p);
      setForm((prev) => ({
        ...prev,
        empresa:              p.empresa,
        contacto:             p.contacto,
        email:                p.email                 ?? "",
        telefono:             p.telefono              ?? "",
        proxima_accion:       p.proxima_accion        ?? "",
        fecha_proxima_accion: p.fecha_proxima_accion  ?? "",
        creado_por:           p.creado_por            ?? "",
        responsable:          p.responsable           ?? "",
        observaciones:        p.observaciones ?? "",
      }));
    } finally {
      setCargando(false);
    }
  }, [id]);

  useEffect(() => {
    if (id) void cargar();
    else {
      setNotFound(true);
      setCargando(false);
    }
  }, [id, cargar]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) {
    setErrorForm(null);
    const { name, value } = e.target;
    const type = (e.target as HTMLInputElement).type;
    const upper = ["empresa", "contacto", "responsable"];
    let normalized = value;
    if (name === "email" || type === "email") normalized = value.toLowerCase();
    else if (upper.includes(name)) normalized = value.toUpperCase();
    setForm((prev) => ({ ...prev, [name]: normalized }));
  }

  function togglePlan(planId: string) {
    setForm((prev) => ({
      ...prev,
      planIds: prev.planIds.includes(planId)
        ? prev.planIds.filter((id) => id !== planId)
        : [...prev.planIds, planId],
    }));
  }

  const planesActivos = planes.filter((p) => p.estado === "activo");
  const valorEstimado = form.planIds.reduce(
    (sum, pid) => sum + (planesActivos.find((p) => p.id === pid)?.precio ?? 0),
    0
  );

  async function handleGuardar(e: React.FormEvent) {
    e.preventDefault();
    setErrorForm(null);
    if (!form.empresa.trim())  return setErrorForm("La empresa es obligatoria.");
    if (!form.contacto.trim()) return setErrorForm("El contacto es obligatorio.");

    const planesActivos = planes.filter((p) => p.estado === "activo");
    const servicioTexto = form.planIds
      .map((pid) => planesActivos.find((p) => p.id === pid)?.nombre)
      .filter(Boolean)
      .join(", ");
    const valorEstimado = form.planIds.reduce(
      (sum, pid) => sum + (planesActivos.find((p) => p.id === pid)?.precio ?? 0),
      0
    );

    const actualizado = await updateProspecto(id, {
      empresa:              form.empresa.trim().toUpperCase(),
      contacto:             form.contacto.trim().toUpperCase(),
      email:                form.email.trim()    || undefined,
      telefono:             form.telefono.trim() || undefined,
      servicio:             servicioTexto,
      valor_estimado:       valorEstimado,
      proxima_accion:       form.proxima_accion.trim()       || undefined,
      fecha_proxima_accion: form.fecha_proxima_accion        || undefined,
      responsable:          form.responsable.trim().toUpperCase() || undefined,
      observaciones:        form.observaciones.trim() ? form.observaciones.trim() : null,
    });

    if (actualizado) router.push("/crm");
  }

  async function handleCambiarEtapa(etapaCodigo: string) {
    await moveProspecto(id, etapaCodigo);
    cargar();
  }

  async function handleAgregarNota(e: React.FormEvent) {
    e.preventDefault();
    if (!nuevaNota.trim()) return;
    setGuardandoNota(true);
    await addNota(id, nuevaNota);
    setNuevaNota("");
    cargar();
    setGuardandoNota(false);
    setTimeout(() => notaInputRef.current?.focus(), 0);
  }

  async function handleEliminar() {
    await deleteProspecto(id);
    router.push("/crm");
  }

  // ── Carga / not found ───────────────────────────────────────────────────────

  if (cargando) {
    return (
      <div className="space-y-4 max-w-3xl animate-pulse">
        <div className="h-6 w-40 bg-slate-200 rounded" />
        <div className="h-10 w-2/3 bg-slate-200 rounded" />
        <div className="h-48 bg-slate-100 rounded-xl border border-slate-200" />
        <div className="h-64 bg-slate-100 rounded-xl border border-slate-200" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-gray-800">Prospecto no encontrado</h1>
        <button
          onClick={() => router.push("/crm")}
          className="text-sm text-gray-500 underline"
        >
          ← Volver al funnel
        </button>
      </div>
    );
  }

  if (!prospecto) return null;

  const etapaActual = etapas.find((e) => e.codigo === prospecto.etapa);
  const etapaActualClasses = etapaActual ? getEtapaClasses(etapaActual.color) : null;

  return (
    <div className="space-y-8 max-w-3xl">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <button
            onClick={() => router.push("/crm")}
            className="text-xs text-gray-400 hover:text-gray-600 mb-2 flex items-center gap-1"
          >
            ← Funnel CRM
          </button>
          <h1 className="text-2xl font-bold text-gray-800">{prospecto.empresa}</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-sm text-gray-400 font-mono">{prospecto.numero_control}</span>
            {etapaActual && etapaActualClasses && (
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${etapaActualClasses.border} ${etapaActualClasses.headerBg} ${etapaActualClasses.headerText}`}>
                {etapaActual.nombre}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => setConfirmarEliminar(true)}
          className="text-red-400 hover:text-red-700 hover:bg-red-50 p-2 rounded-lg transition-colors"
          title="Eliminar prospecto"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      {/* Confirmación de eliminación */}
      {confirmarEliminar && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center justify-between gap-4">
          <p className="text-sm text-red-700 font-medium">
            ¿Eliminar permanentemente este prospecto?
          </p>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={handleEliminar}
              className="bg-red-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-red-700"
            >
              Sí, eliminar
            </button>
            <button
              onClick={() => setConfirmarEliminar(false)}
              className="border border-red-200 text-red-600 px-3 py-1.5 rounded-lg text-xs hover:bg-red-100"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* ── Sección: Cambiar etapa ────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow p-5">
        <SectionTitle>Etapa del funnel</SectionTitle>
        <div className="flex flex-wrap gap-2">
          {etapas.map((e) => {
            const cls = getEtapaClasses(e.color);
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => handleCambiarEtapa(e.codigo)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  prospecto.etapa === e.codigo
                    ? `${cls.headerBg} ${cls.headerText} ${cls.border} ring-2 ring-offset-1 ring-gray-400`
                    : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
                }`}
              >
                {e.nombre}
              </button>
            );
          })}
        </div>
        {prospecto.etapa === "GANADO" && (
          <div className="mt-3 bg-green-50 border border-green-200 rounded-lg px-4 py-2.5 flex items-center justify-between">
            <p className="text-sm text-green-700 font-medium">✓ Oportunidad ganada</p>
            <a
              href={`/clientes/nuevo?from_crm=${prospecto?.id ?? id}`}
              className="text-sm text-green-600 hover:text-green-900 font-semibold underline"
            >
              Crear cliente →
            </a>
          </div>
        )}
      </div>

      {/* ── Sección: Datos del prospecto ─────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow p-5">
        <SectionTitle>Datos del prospecto</SectionTitle>

        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="text-sm text-gray-600">
            <span className="font-semibold text-gray-700">Origen:</span>{" "}
            <span className="text-gray-800">{originLabel(prospecto.origen_creacion)}</span>
          </div>
          {conversationId && (
            <Link
              href={`/dashboard/conversaciones?conversationId=${encodeURIComponent(conversationId)}`}
              className="text-sm text-[#0EA5E9] hover:underline font-semibold shrink-0"
            >
              Abrir conversación →
            </Link>
          )}
        </div>

        <form onSubmit={handleGuardar} className="space-y-4">

          {/* Empresa */}
          <div>
            <label className={labelClass}>Empresa <span className="text-red-500">*</span></label>
            <input
              type="text"
              name="empresa"
              value={form.empresa}
              onChange={handleChange}
              className={`${inputClass} uppercase`}
              required
            />
          </div>

          {/* Contacto + Teléfono */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Contacto <span className="text-red-500">*</span></label>
              <input
                type="text"
                name="contacto"
                value={form.contacto}
                onChange={handleChange}
                className={`${inputClass} uppercase`}
                required
              />
            </div>
            <div>
              <label className={labelClass}>Teléfono</label>
              <input
                type="text"
                name="telefono"
                value={form.telefono}
                onChange={handleChange}
                className={inputClass}
              />
            </div>
          </div>

          {/* Email */}
          <div>
            <label className={labelClass}>Email</label>
            <input
              type="email"
              name="email"
              value={form.email}
              onChange={handleChange}
              className={inputClass}
            />
          </div>

          {/* Comentarios / observaciones internas */}
          <div>
            <label className={labelClass}>Comentarios / observaciones internas</label>
            <textarea
              name="observaciones"
              value={form.observaciones}
              onChange={handleChange}
              rows={4}
              placeholder="Contexto comercial, objeciones, acuerdos, próximos pasos… (visible solo en el equipo)"
              className={`${inputClass} resize-y min-h-[100px]`}
            />
            <p className="text-xs text-gray-500 mt-1">
              Distinto de las notas con fecha abajo: este bloque es un campo único editable del prospecto.
            </p>
          </div>

          {/* Servicio */}
          <div>
            <label className={labelClass}>Servicios / Productos de interés</label>
            {cargandoPlanes ? (
              <p className="text-sm text-gray-400 py-2">Cargando planes…</p>
            ) : planes.length === 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <p className="font-medium">No hay planes creados para esta empresa.</p>
                <Link
                  href="/planes/nuevo"
                  className="mt-2 inline-flex items-center gap-1.5 text-[#0EA5E9] hover:text-[#0284C7] font-medium"
                >
                  Ir a crear plan →
                </Link>
              </div>
            ) : (
              <PlanSelector
                planes={planes}
                selectedIds={form.planIds}
                onToggle={togglePlan}
                placeholder="Buscar plan por nombre…"
              />
            )}
          </div>

          {/* Valor estimado */}
          <div>
            <label className={labelClass}>Valor estimado (Gs.)</label>
            <input
              type="text"
              readOnly
              value={valorEstimado > 0 ? valorEstimado.toLocaleString("es-PY") : ""}
              placeholder="Se calcula automáticamente"
              className={`${inputClass} bg-slate-50 cursor-not-allowed`}
            />
            {valorEstimado > 0 && (
              <p className="text-xs text-gray-500 mt-1">Suma de los planes seleccionados</p>
            )}
          </div>

          {/* Próxima acción */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Próxima acción</label>
              <input
                type="text"
                name="proxima_accion"
                value={form.proxima_accion}
                onChange={handleChange}
                placeholder="Ej: Enviar propuesta"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Fecha próxima acción</label>
              <input
                type="date"
                name="fecha_proxima_accion"
                value={form.fecha_proxima_accion}
                onChange={handleChange}
                className={inputClass}
              />
            </div>
          </div>

          {/* Equipo */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Responsable</label>
              <input
                type="text"
                name="responsable"
                value={form.responsable}
                onChange={handleChange}
                placeholder="Ej: JUAN PÉREZ"
                className={`${inputClass} uppercase`}
              />
            </div>
            <div>
              <label className={labelClass}>Creado por</label>
              <input
                type="text"
                readOnly
                value={form.creado_por || "—"}
                className={`${inputClass} bg-slate-50 cursor-not-allowed`}
              />
              <p className="text-xs text-gray-500 mt-1">Registro inmutable del creador del lead</p>
            </div>
          </div>

          {errorForm && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
              <span>⚠</span><span className="font-medium">{errorForm}</span>
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              className="bg-gray-900 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors"
            >
              Guardar cambios
            </button>
            <button
              type="button"
              onClick={() => router.push("/crm")}
              className="border border-gray-300 px-5 py-2.5 rounded-lg text-sm hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
          </div>
        </form>
      </div>

      {/* ── Sección: Notas internas ──────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow p-5">
        <SectionTitle>Notas internas ({prospecto.notas.length})</SectionTitle>

        <form onSubmit={handleAgregarNota} className="mb-5">
          <label className={labelClass}>Nueva nota</label>
          <textarea
            ref={notaInputRef}
            value={nuevaNota}
            onChange={(e) => setNuevaNota(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleAgregarNota(e as unknown as React.FormEvent);
              }
            }}
            rows={3}
            placeholder="Escribí una nota interna (Ctrl+Enter para guardar rápido)..."
            className={`${inputClass} resize-none mb-3`}
          />
          <button
            type="submit"
            disabled={!nuevaNota.trim() || guardandoNota}
            className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Agregar nota
          </button>
        </form>

        {prospecto.notas.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No hay notas registradas aún.</p>
        ) : (
          <div className="space-y-3">
            {[...prospecto.notas].reverse().map((nota: Nota) => (
              <div
                key={nota.id}
                className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3"
              >
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{nota.texto}</p>
                <p className="text-xs text-gray-400 mt-2">{formatFecha(nota.fecha)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
