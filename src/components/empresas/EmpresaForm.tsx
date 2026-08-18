"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  crearEmpresa,
  getDashboardViewsCatalog,
  getModulos,
  type DashboardViewCatalog,
} from "@/lib/empresas/actions";
import type { Modulo } from "@/lib/empresas/actions";

const fLabel = "block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1";
const fInput = "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0EA5E9] bg-white";

export default function EmpresaForm() {
  const router = useRouter();
  const envioEnCurso = useRef(false);
  const [modulos, setModulos] = useState<Modulo[]>([]);
  const [cargandoModulos, setCargandoModulos] = useState(true);
  const [dashboardViews, setDashboardViews] = useState<DashboardViewCatalog[]>([]);
  const [cargandoDashboard, setCargandoDashboard] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    nombre_empresa: "",
    plan: "",
    ruc: "",
    estado: "activo" as "activo" | "inactivo",
    email: "",
    password: "",
    nombre: "",
    modulo_ids: [] as string[],
    dashboard_view_ids: [] as string[],
  });

  useEffect(() => {
    getModulos()
      .then(setModulos)
      .catch(console.error)
      .finally(() => setCargandoModulos(false));
  }, []);

  useEffect(() => {
    getDashboardViewsCatalog()
      .then(setDashboardViews)
      .catch(console.error)
      .finally(() => setCargandoDashboard(false));
  }, []);

  useEffect(() => {
    if (dashboardViews.length === 0) return;
    setForm((p) =>
      p.dashboard_view_ids.length > 0 ? p : { ...p, dashboard_view_ids: dashboardViews.map((d) => d.id) }
    );
  }, [dashboardViews]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value, type } = e.target;
    if (type === "checkbox") {
      const checked = (e.target as HTMLInputElement).checked;
      const id = (e.target as HTMLInputElement).value;
      const field = (e.target as HTMLInputElement).getAttribute("data-field");
      if (field === "dashboard_view") {
        setForm((prev) => ({
          ...prev,
          dashboard_view_ids: checked
            ? [...prev.dashboard_view_ids, id]
            : prev.dashboard_view_ids.filter((x) => x !== id),
        }));
        return;
      }
      setForm((prev) => ({
        ...prev,
        modulo_ids: checked
          ? [...prev.modulo_ids, id]
          : prev.modulo_ids.filter((m) => m !== id),
      }));
    } else {
      let normalized = value;
      if (name === "email" || type === "email") normalized = value.toLowerCase();
      else if (["nombre_empresa", "nombre", "plan"].includes(name)) normalized = value.toUpperCase();
      setForm((prev) => ({ ...prev, [name]: normalized }));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (envioEnCurso.current) return;
    setError(null);

    if (!form.nombre_empresa.trim()) return setError("El nombre de la empresa es obligatorio.");
    if (!form.email.trim()) return setError("El email del administrador es obligatorio.");
    if (!form.password) return setError("La contraseña es obligatoria.");
    if (form.password.length < 6) return setError("La contraseña debe tener al menos 6 caracteres.");
    if (!form.nombre.trim()) return setError("El nombre del administrador es obligatorio.");

    envioEnCurso.current = true;
    setGuardando(true);

    try {
      await crearEmpresa({
        nombre_empresa: form.nombre_empresa.trim(),
        plan: form.plan.trim(),
        ruc: form.ruc.trim(),
        estado: form.estado,
        email: form.email.trim().toLowerCase(),
        password: form.password,
        nombre: form.nombre.trim(),
        modulo_ids: form.modulo_ids,
        dashboard_view_ids: form.dashboard_view_ids,
      });
      router.push("/admin/empresas");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      envioEnCurso.current = false;
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8 max-w-2xl">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {/* Datos empresa */}
      <section className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-5 pb-2 border-b border-gray-100">
          <span className="text-base">🏢</span>
          <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider">Datos de la empresa</h3>
        </div>
        <div className="space-y-4">
          <div>
            <label className={fLabel}>Nombre de la empresa *</label>
            <input
              type="text"
              name="nombre_empresa"
              value={form.nombre_empresa}
              onChange={handleChange}
              placeholder="Ej: MI EMPRESA S.A."
              className={`${fInput} uppercase`}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={fLabel}>Plan</label>
              <input
                type="text"
                name="plan"
                value={form.plan}
                onChange={handleChange}
                placeholder="Ej: Básico, Pro, Enterprise"
                className={fInput}
              />
            </div>
            <div>
              <label className={fLabel}>RUC</label>
              <input
                type="text"
                name="ruc"
                value={form.ruc}
                onChange={handleChange}
                placeholder="00000000-0"
                className={fInput}
              />
            </div>
          </div>
          <div>
            <label className={fLabel}>Estado</label>
            <select
              name="estado"
              value={form.estado}
              onChange={handleChange}
              className={fInput}
            >
              <option value="activo">Activo</option>
              <option value="inactivo">Inactivo</option>
            </select>
          </div>
        </div>
      </section>

      {/* Usuario administrador */}
      <section className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-5 pb-2 border-b border-gray-100">
          <span className="text-base">👤</span>
          <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider">Usuario administrador</h3>
        </div>
        <div className="space-y-4">
          <div>
            <label className={fLabel}>Nombre completo *</label>
            <input
              type="text"
              name="nombre"
              value={form.nombre}
              onChange={handleChange}
              placeholder="Ej: JUAN PÉREZ"
              className={`${fInput} uppercase`}
              required
            />
          </div>
          <div>
            <label className={fLabel}>Email *</label>
            <input
              type="email"
              name="email"
              value={form.email}
              onChange={handleChange}
              placeholder="admin@empresa.com"
              className={fInput}
              required
            />
          </div>
          <div>
            <label className={fLabel}>Contraseña *</label>
            <input
              type="password"
              name="password"
              value={form.password}
              onChange={handleChange}
              placeholder="Mínimo 6 caracteres"
              className={fInput}
              required
              minLength={6}
            />
          </div>
        </div>
      </section>

      {/* Módulos habilitados */}
      <section className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-5 pb-2 border-b border-gray-100">
          <span className="text-base">📦</span>
          <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider">Módulos habilitados</h3>
        </div>
        {cargandoModulos ? (
          <p className="text-sm text-gray-400">Cargando módulos…</p>
        ) : modulos.length === 0 ? (
          <p className="text-sm text-gray-400">No hay módulos configurados en el sistema.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {modulos.map((m) => (
              <label
                key={m.id}
                className="flex items-center gap-2 cursor-pointer p-2 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <input
                  type="checkbox"
                  value={m.id}
                  checked={form.modulo_ids.includes(m.id)}
                  onChange={handleChange}
                  className="rounded border-gray-300"
                />
                <span className="text-sm text-gray-700">{m.nombre ?? m.name ?? m.id}</span>
              </label>
            ))}
          </div>
        )}
      </section>

      <section className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-5 pb-2 border-b border-gray-100">
          <span className="text-base">📊</span>
          <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider">
            Vistas del dashboard
          </h3>
        </div>
        <p className="text-xs text-slate-500 mb-3">
          Definí qué pestañas del tablero principal tendrá esta empresa. Si no marcás ninguna, se habilitan todas
          las vistas del catálogo.
        </p>
        {cargandoDashboard ? (
          <p className="text-sm text-gray-400">Cargando vistas…</p>
        ) : dashboardViews.length === 0 ? (
          <p className="text-sm text-gray-400">No hay vistas en el catálogo.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {dashboardViews.map((d) => (
              <label
                key={d.id}
                className="flex items-center gap-2 cursor-pointer p-2 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <input
                  type="checkbox"
                  data-field="dashboard_view"
                  value={d.id}
                  checked={form.dashboard_view_ids.includes(d.id)}
                  onChange={handleChange}
                  className="rounded border-gray-300"
                />
                <span className="text-sm text-gray-700">{d.nombre}</span>
              </label>
            ))}
          </div>
        )}
      </section>

      <div className="flex gap-4">
        <button
          type="submit"
          disabled={guardando}
          className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white text-sm font-semibold px-6 py-2.5 rounded-lg transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
        >
          {guardando ? "Creando…" : "Crear empresa"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/admin/empresas")}
          className="border border-slate-200 text-sm px-6 py-2.5 rounded-lg hover:bg-slate-50 transition-colors"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
