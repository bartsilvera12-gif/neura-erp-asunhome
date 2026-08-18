"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import MontoInput from "@/components/ui/MontoInput";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { getPlan, updatePlan, toggleEstadoPlan, deletePlan } from "@/lib/planes/storage";
import type { Plan, PlanMarketingItem } from "@/lib/planes/types";
import { TIPOS_CONTENIDO } from "@/lib/marketing/types";
import { Suspense } from "react";

// ── Helpers ───────────────────────────────────────────────────────────────────

const fLabelClass = "block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1";
const fInputClass =
  "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0EA5E9] bg-white disabled:bg-slate-50 disabled:text-slate-500";
const fSelectClass =
  "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0EA5E9] bg-white disabled:bg-slate-50 disabled:text-slate-500";

function formatGs(n: number) {
  return n.toLocaleString("es-PY");
}

function formatPrecio(p: Plan) {
  return p.moneda === "USD"
    ? `USD ${p.precio.toLocaleString("en-US")}`
    : `Gs. ${formatGs(p.precio)}`;
}

function limiteLabel(v: number | null) {
  return v === null ? "Ilimitado" : v.toLocaleString("es-PY");
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider border-b border-gray-100 pb-2 mb-4">
      {children}
    </h3>
  );
}

// ── Badges ────────────────────────────────────────────────────────────────────

function BadgeEstado({ estado }: { estado: Plan["estado"] }) {
  return (
    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
      estado === "activo"
        ? "bg-green-100 text-green-700"
        : "bg-gray-100 text-gray-500"
    }`}>
      {estado}
    </span>
  );
}

function BadgePeriodicidad({ p }: { p: Plan["periodicidad"] }) {
  const cfg = {
    mensual: "bg-blue-50 text-blue-600 border-blue-100",
    anual:   "bg-violet-50 text-violet-600 border-violet-100",
    unico:   "bg-amber-50 text-amber-600 border-amber-100",
  };
  const label = { mensual: "Mensual", anual: "Anual", unico: "Único" };
  return (
    <span className={`text-xs px-2 py-0.5 rounded border ${cfg[p]}`}>
      {label[p]}
    </span>
  );
}

// ── Componente interno (usa useSearchParams) ──────────────────────────────────

function PlanDetailContent() {
  const params       = useParams();
  const router       = useRouter();
  const searchParams = useSearchParams();
  if (!params) return null;
  const id = params.id as string;
  const editMode = searchParams?.get("edit") === "1";

  const [plan,      setPlan]      = useState<Plan | null>(null);
  const [editing,   setEditing]   = useState(editMode);
  const [formError, setFormError] = useState<string | null>(null);
  const [showDel,   setShowDel]   = useState(false);

  const [form, setForm] = useState({
    nombre:          "",
    descripcion:     "",
    precio:          "",
    moneda:          "GS" as "GS" | "USD",
    periodicidad:    "mensual" as "mensual" | "anual" | "unico",
    limite_usuarios: "",
    limite_clientes: "",
    limite_facturas: "",
    estado:          "activo" as "activo" | "inactivo",
    es_plan_marketing: false,
    plantilla_items: [] as PlanMarketingItem[],
  });

  useEffect(() => {
    getPlan(id).then((p) => {
      if (!p) { router.push("/planes"); return; }
      setPlan(p);
      setForm({
        nombre:          p.nombre,
        descripcion:     p.descripcion ?? "",
        precio:          String(p.precio),
        moneda:          p.moneda,
        periodicidad:    p.periodicidad,
        limite_usuarios: p.limite_usuarios !== null ? String(p.limite_usuarios) : "",
        limite_clientes: p.limite_clientes !== null ? String(p.limite_clientes) : "",
        limite_facturas: p.limite_facturas !== null ? String(p.limite_facturas) : "",
        estado:          p.estado,
        es_plan_marketing: Boolean(p.es_plan_marketing),
        plantilla_items: p.plantilla_operativa?.items ?? [],
      });
    });
  }, [id, router]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
    const { name, value } = e.target;
    const upper = ["nombre"];
    setForm((prev) => ({
      ...prev,
      [name]: upper.includes(name) ? value.toUpperCase() : value,
    }));
  }

  async function handleGuardar(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!form.nombre.trim()) { setFormError("El nombre es obligatorio."); return; }
    if (!form.precio || parseFloat(form.precio) <= 0) {
      setFormError("El precio debe ser mayor a 0."); return;
    }

    const itemsNorm = form.plantilla_items.map((it) => {
      if (it.periodicidad === "semanal") {
        return { ...it, cantidad: Math.max(1, (it.dias_semana ?? []).length) };
      }
      return it;
    });

    const actualizado = await updatePlan(id, {
      nombre:          form.nombre.trim(),
      descripcion:     form.descripcion.trim() || undefined,
      precio:          parseFloat(form.precio),
      moneda:          form.moneda,
      periodicidad:    form.periodicidad,
      limite_usuarios: form.limite_usuarios ? parseInt(form.limite_usuarios, 10) : null,
      limite_clientes: form.limite_clientes ? parseInt(form.limite_clientes, 10) : null,
      limite_facturas: form.limite_facturas ? parseInt(form.limite_facturas, 10) : null,
      estado:          form.estado,
      es_plan_marketing: form.es_plan_marketing,
      plantilla_operativa: itemsNorm.length > 0 ? { items: itemsNorm } : undefined,
    });

    if (!actualizado.ok) {
      setFormError(actualizado.error);
      return;
    }
    router.push("/planes");
  }

  async function handleToggleEstado() {
    if (!plan) return;
    const nuevo = plan.estado === "activo" ? "inactivo" : "activo";
    await toggleEstadoPlan(id, nuevo);
    router.push("/planes");
  }

  async function handleEliminar() {
    const r = await deletePlan(id);
    if (!r.ok) {
      setFormError(r.error);
      return;
    }
    router.push("/planes");
  }

  if (!plan) {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-gray-400">
        Cargando…
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-2xl">

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <Link href="/planes" className="hover:text-gray-700 transition-colors">Planes</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">{plan.codigo_plan}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900">{plan.nombre}</h1>
            <span className="font-mono text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
              {plan.codigo_plan}
            </span>
            <BadgeEstado estado={plan.estado} />
            <BadgePeriodicidad p={plan.periodicidad} />
          </div>
          {plan.descripcion && (
            <p className="text-sm text-gray-500 mt-1">{plan.descripcion}</p>
          )}
          <p className="text-xl font-bold text-gray-800 mt-2">{formatPrecio(plan)}</p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {!editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors text-slate-700"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path d="M2.695 14.763l-1.262 3.154a.5.5 0 0 0 .65.65l3.155-1.262a4 4 0 0 0 1.343-.885L17.5 5.5a2.121 2.121 0 0 0-3-3L3.58 13.42a4 4 0 0 0-.885 1.343Z" />
              </svg>
              Editar
            </button>
          )}
          <button
            type="button"
            onClick={handleToggleEstado}
            className={`text-sm font-medium px-3 py-2 rounded-lg border transition-colors ${
              plan.estado === "activo"
                ? "border-red-200 text-red-600 hover:bg-red-50"
                : "border-green-200 text-green-600 hover:bg-green-50"
            }`}
          >
            {plan.estado === "activo" ? "Desactivar" : "Activar"}
          </button>
        </div>
      </div>

      {/* Plan marketing (vista) */}
      {!editing && plan.es_plan_marketing && plan.plantilla_operativa?.items?.length && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <SectionTitle>Plan de marketing</SectionTitle>
          <p className="text-sm text-slate-600 mb-3">Este plan genera tareas de contenido automáticamente.</p>
          <ul className="space-y-2">
            {plan.plantilla_operativa.items.map((item, i) => (
              <li key={i} className="text-sm">
                <span className="font-medium capitalize">{item.tipo_contenido}</span>
                {" — "}
                {item.periodicidad === "semanal"
                  ? `${Math.max(1, (item.dias_semana ?? []).length)} por semana${item.dias_semana?.length ? ` (${(item.dias_semana ?? []).map((d) => ["Do", "Lu", "Ma", "Mi", "Ju", "Vi", "Sa"][d]).join(", ")})` : ""}`
                  : `${item.cantidad} por mes (semana ${item.semana_del_mes ?? 1})`}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Resumen de límites (vista) */}
      {!editing && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <SectionTitle>Límites del plan</SectionTitle>
          <div className="grid grid-cols-3 gap-6">
            {[
              { label: "Usuarios",  value: limiteLabel(plan.limite_usuarios) },
              { label: "Clientes",  value: limiteLabel(plan.limite_clientes) },
              { label: "Facturas",  value: limiteLabel(plan.limite_facturas) },
            ].map((item) => (
              <div key={item.label} className="text-center p-4 rounded-lg bg-gray-50">
                <p className="text-xs text-gray-400 mb-1">{item.label}</p>
                <p className={`text-lg font-bold ${item.value === "Ilimitado" ? "text-violet-600" : "text-gray-800"}`}>
                  {item.value}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Formulario de edición */}
      {editing && (
        <form onSubmit={handleGuardar} className="space-y-6">

          {formError && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
              {formError}
            </div>
          )}

          <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <SectionTitle>Información general</SectionTitle>
            <div className="space-y-4">
              <div>
                <label className={fLabelClass}>Nombre del plan *</label>
                <input
                  type="text"
                  name="nombre"
                  value={form.nombre}
                  onChange={handleChange}
                  className={`${fInputClass} uppercase`}
                  required
                />
              </div>
              <div>
                <label className={fLabelClass}>Descripción</label>
                <textarea
                  name="descripcion"
                  value={form.descripcion}
                  onChange={handleChange}
                  rows={3}
                  className={fInputClass}
                />
              </div>
              <div>
                <label className={fLabelClass}>Estado</label>
                <select name="estado" value={form.estado} onChange={handleChange} className={fSelectClass}>
                  <option value="activo">Activo</option>
                  <option value="inactivo">Inactivo</option>
                </select>
              </div>
            </div>
          </section>

          <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <SectionTitle>Precio y periodicidad</SectionTitle>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className={fLabelClass}>Precio *</label>
                <MontoInput
                  value={form.precio}
                  onChange={(n) => setForm((p) => ({ ...p, precio: String(n) }))}
                  className={fInputClass}
                  decimals={form.moneda === "USD"}
                  required
                />
              </div>
              <div>
                <label className={fLabelClass}>Moneda</label>
                <select name="moneda" value={form.moneda} onChange={handleChange} className={fSelectClass}>
                  <option value="GS">Guaraníes (GS)</option>
                  <option value="USD">Dólares (USD)</option>
                </select>
              </div>
              <div>
                <label className={fLabelClass}>Periodicidad</label>
                <select name="periodicidad" value={form.periodicidad} onChange={handleChange} className={fSelectClass}>
                  <option value="mensual">Mensual</option>
                  <option value="anual">Anual</option>
                  <option value="unico">Único</option>
                </select>
              </div>
            </div>
          </section>

          <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <SectionTitle>Plan de marketing</SectionTitle>
            <div className="space-y-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.es_plan_marketing}
                  onChange={(e) => setForm((p) => ({ ...p, es_plan_marketing: e.target.checked }))}
                  className="rounded border-slate-300"
                />
                <span className="text-sm font-medium">Es plan de marketing</span>
              </label>
              {form.es_plan_marketing && (
                <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                  <p className="text-xs text-slate-500">Plantilla operativa (genera tareas automáticamente)</p>
                  {form.plantilla_items.map((item, idx) => (
                    <div key={idx} className="flex flex-wrap items-center gap-2 p-3 bg-slate-50 rounded-lg">
                      <select
                        value={item.tipo_contenido}
                        onChange={(e) => {
                          const items = [...form.plantilla_items];
                          items[idx] = { ...item, tipo_contenido: e.target.value as PlanMarketingItem["tipo_contenido"] };
                          setForm((p) => ({ ...p, plantilla_items: items }));
                        }}
                        className="text-sm border border-slate-200 rounded px-2 py-1"
                      >
                        {TIPOS_CONTENIDO.map((t) => (
                          <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                        ))}
                      </select>
                      <select
                        value={item.periodicidad}
                        onChange={(e) => {
                          const items = [...form.plantilla_items];
                          const periodicidad = e.target.value as "semanal" | "mensual";
                          const next = { ...item, periodicidad };
                          if (periodicidad === "semanal") {
                            next.cantidad = Math.max(1, (item.dias_semana ?? []).length);
                          }
                          items[idx] = next;
                          setForm((p) => ({ ...p, plantilla_items: items }));
                        }}
                        className="text-sm border border-slate-200 rounded px-2 py-1"
                      >
                        <option value="semanal">Semanal</option>
                        <option value="mensual">Mensual</option>
                      </select>
                      {item.periodicidad === "mensual" ? (
                        <input
                          type="number"
                          min={1}
                          value={item.cantidad}
                          onChange={(e) => {
                            const items = [...form.plantilla_items];
                            items[idx] = { ...item, cantidad: parseInt(e.target.value, 10) || 1 };
                            setForm((p) => ({ ...p, plantilla_items: items }));
                          }}
                          className="w-14 text-sm border border-slate-200 rounded px-2 py-1"
                          placeholder="Cant."
                        />
                      ) : (
                        <span className="text-xs text-slate-500 w-14">{Math.max(1, (item.dias_semana ?? []).length)} tareas/sem</span>
                      )}
                      {item.periodicidad === "semanal" && (
                        <span className="text-xs text-slate-500">Días: </span>
                      )}
                      {item.periodicidad === "semanal" && (
                        [0, 1, 2, 3, 4, 5, 6].map((d) => (
                          <label key={d} className="flex items-center gap-0.5 text-xs cursor-pointer">
                            <input
                              type="checkbox"
                              checked={(item.dias_semana ?? []).includes(d)}
                              onChange={(e) => {
                                const items = [...form.plantilla_items];
                                const ds = item.dias_semana ?? [];
                                const next = e.target.checked ? [...ds, d].sort((a, b) => a - b) : ds.filter((x) => x !== d);
                                items[idx] = { ...item, dias_semana: next, cantidad: Math.max(1, next.length) };
                                setForm((p) => ({ ...p, plantilla_items: items }));
                              }}
                            />
                            <span>{["Do", "Lu", "Ma", "Mi", "Ju", "Vi", "Sa"][d]}</span>
                          </label>
                        ))
                      )}
                      {item.periodicidad === "mensual" && (
                        <>
                          <span className="text-xs text-slate-500">Semana:</span>
                          <select
                            value={item.semana_del_mes ?? 1}
                            onChange={(e) => {
                              const items = [...form.plantilla_items];
                              items[idx] = { ...item, semana_del_mes: parseInt(e.target.value, 10) };
                              setForm((p) => ({ ...p, plantilla_items: items }));
                            }}
                            className="text-sm border border-slate-200 rounded px-2 py-1"
                          >
                            {[1, 2, 3, 4].map((s) => (
                              <option key={s} value={s}>{s}ª del mes</option>
                            ))}
                          </select>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => setForm((p) => ({ ...p, plantilla_items: form.plantilla_items.filter((_, i) => i !== idx) }))}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Quitar
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setForm((p) => ({
                      ...p,
                      plantilla_items: [...p.plantilla_items, { tipo_contenido: "post", periodicidad: "semanal", cantidad: 3, dias_semana: [1, 3, 5] }],
                    }))}
                    className="text-sm text-[#0EA5E9] hover:underline"
                  >
                    + Agregar item
                  </button>
                </div>
              )}
            </div>
          </section>

          <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <SectionTitle>Límites del plan</SectionTitle>
            <p className="text-xs text-gray-400 mb-4">
              Dejar en blanco para indicar que el límite es <strong>ilimitado</strong>.
            </p>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className={fLabelClass}>Usuarios</label>
                <input type="number" name="limite_usuarios" value={form.limite_usuarios} onChange={handleChange} min={1} step="1" placeholder="Ilimitado" className={fInputClass} />
              </div>
              <div>
                <label className={fLabelClass}>Clientes</label>
                <input type="number" name="limite_clientes" value={form.limite_clientes} onChange={handleChange} min={1} step="1" placeholder="Ilimitado" className={fInputClass} />
              </div>
              <div>
                <label className={fLabelClass}>Facturas</label>
                <input type="number" name="limite_facturas" value={form.limite_facturas} onChange={handleChange} min={1} step="1" placeholder="Ilimitado" className={fInputClass} />
              </div>
            </div>
          </section>

          <div className="flex items-center gap-3">
<button
            type="submit"
            className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white text-sm font-semibold px-6 py-2.5 rounded-lg transition-colors shadow-sm active:scale-95"
          >
            Guardar cambios
          </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-sm text-gray-500 hover:text-gray-800 transition-colors px-4 py-2.5"
            >
              Cancelar
            </button>
          </div>

        </form>
      )}

      {/* Zona peligrosa */}
      <div className="bg-white rounded-xl border border-red-100 shadow-sm p-6">
        <SectionTitle>Zona peligrosa</SectionTitle>
        {!showDel ? (
          <button
            type="button"
            onClick={() => setShowDel(true)}
            className="text-sm text-red-600 hover:text-red-800 font-medium border border-red-200 px-4 py-2 rounded-lg hover:bg-red-50 transition-colors"
          >
            Eliminar este plan
          </button>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-red-700 font-medium">
              ¿Confirmar eliminación de <strong>{plan.nombre}</strong>? Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleEliminar}
                className="text-sm font-semibold bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors"
              >
                Sí, eliminar
              </button>
              <button
                type="button"
                onClick={() => setShowDel(false)}
                className="text-sm text-gray-500 hover:text-gray-800 px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}

// ── Wrapper con Suspense (requerido por useSearchParams) ──────────────────────

export default function PlanDetailPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-24 text-sm text-gray-400">
        Cargando…
      </div>
    }>
      <PlanDetailContent />
    </Suspense>
  );
}
