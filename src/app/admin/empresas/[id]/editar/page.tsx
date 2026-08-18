"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  getEmpresaById,
  getModulos,
  getDashboardViewsCatalog,
  actualizarEmpresa,
  actualizarUsuario,
  resetearPasswordUsuario,
  type DashboardViewCatalog,
} from "@/lib/empresas/actions";
import type { Modulo, UsuarioEmpresa } from "@/lib/empresas/actions";

const fLabel = "block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1";
const fInput =
  "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0EA5E9] bg-white";

function BadgeEstado({ estado }: { estado: string }) {
  const activo = estado === "activo";
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
        activo ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${activo ? "bg-green-500" : "bg-gray-400"}`} />
      {activo ? "Activo" : "Inactivo"}
    </span>
  );
}

export default function EditarEmpresaPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params?.id ?? "");
  const [modulos, setModulos] = useState<Modulo[]>([]);
  const [cargandoModulos, setCargandoModulos] = useState(true);
  const [cargandoEmpresa, setCargandoEmpresa] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [admin, setAdmin] = useState<UsuarioEmpresa | null>(null);
  const [adminForm, setAdminForm] = useState({
    nombre: "",
    email: "",
    estado: "activo" as "activo" | "inactivo",
    modulo_ids: [] as string[],
  });
  const [editandoAdmin, setEditandoAdmin] = useState(false);
  const [guardandoAdmin, setGuardandoAdmin] = useState(false);
  const [errorAdmin, setErrorAdmin] = useState<string | null>(null);
  const [mostrarResetPassword, setMostrarResetPassword] = useState(false);
  const [nuevaPassword, setNuevaPassword] = useState("");
  const [guardandoPassword, setGuardandoPassword] = useState(false);

  const [dashCatalog, setDashCatalog] = useState<DashboardViewCatalog[]>([]);

  const [form, setForm] = useState({
    nombre_empresa: "",
    plan: "",
    ruc: "",
    estado: "activo" as "activo" | "inactivo",
    modulo_ids: [] as string[],
    dashboard_view_ids: [] as string[],
  });

  useEffect(() => {
    Promise.all([getModulos(), getDashboardViewsCatalog(), getEmpresaById(id)])
      .then(([mods, dvCat, detalle]) => {
        setModulos(mods);
        setDashCatalog(dvCat ?? []);
        const dvIds =
          detalle.dashboard_view_ids?.length ?
            detalle.dashboard_view_ids
          : (detalle.dashboard_views ?? []).map((v) => v.id);
        setForm({
          nombre_empresa: detalle.empresa.nombre_empresa ?? "",
          plan: detalle.empresa.plan ?? "",
          ruc: detalle.empresa.ruc ?? "",
          estado: (detalle.empresa.estado as "activo" | "inactivo") ?? "activo",
          modulo_ids: detalle.modulos.map((m) => m.id),
          dashboard_view_ids: dvIds,
        });
        const adminUser = detalle.usuarios.find((u) => u.rol === "admin") ?? null;
        setAdmin(adminUser);
        if (adminUser) {
          setAdminForm({
            nombre: adminUser.nombre ?? "",
            email: adminUser.email ?? "",
            estado: (adminUser.estado as "activo" | "inactivo") ?? "activo",
            modulo_ids: adminUser.modulo_ids ?? [],
          });
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Error"))
      .finally(() => {
        setCargandoModulos(false);
        setCargandoEmpresa(false);
      });
  }, [id]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value, type } = e.target;
    if (type === "checkbox") {
      const checked = (e.target as HTMLInputElement).checked;
      const modId = (e.target as HTMLInputElement).value;
      const field = (e.target as HTMLInputElement).getAttribute("data-field");
      if (field === "dashboard_view") {
        setForm((prev) => ({
          ...prev,
          dashboard_view_ids: checked
            ? [...prev.dashboard_view_ids, modId]
            : prev.dashboard_view_ids.filter((x) => x !== modId),
        }));
        return;
      }
      setForm((prev) => ({
        ...prev,
        modulo_ids: checked
          ? [...prev.modulo_ids, modId]
          : prev.modulo_ids.filter((m) => m !== modId),
      }));
    } else {
      setForm((prev) => ({ ...prev, [name]: value }));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.nombre_empresa.trim()) {
      return setError("El nombre de la empresa es obligatorio.");
    }

    setGuardando(true);

    try {
      await actualizarEmpresa(id, {
        nombre_empresa: form.nombre_empresa.trim(),
        plan: form.plan.trim() || undefined,
        ruc: form.ruc.trim() || undefined,
        estado: form.estado,
        modulo_ids: form.modulo_ids,
        dashboard_view_ids: form.dashboard_view_ids,
      });
      router.push(`/admin/empresas/${id}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setGuardando(false);
    }
  }

  async function handleGuardarAdmin(e: React.FormEvent) {
    e.preventDefault();
    if (!admin) return;
    setErrorAdmin(null);
    setGuardandoAdmin(true);
    try {
      await actualizarUsuario(admin.id, {
        nombre: adminForm.nombre.trim(),
        email: adminForm.email.trim() || undefined,
        estado: adminForm.estado,
        modulo_ids: adminForm.modulo_ids,
      });
      setAdmin({ ...admin, ...adminForm });
      setEditandoAdmin(false);
    } catch (err: unknown) {
      setErrorAdmin(err instanceof Error ? err.message : "Error");
    } finally {
      setGuardandoAdmin(false);
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!admin || !nuevaPassword.trim() || nuevaPassword.length < 6) {
      setErrorAdmin("La contraseña debe tener al menos 6 caracteres");
      return;
    }
    setErrorAdmin(null);
    setGuardandoPassword(true);
    try {
      await resetearPasswordUsuario(admin.id, nuevaPassword);
      setNuevaPassword("");
      setMostrarResetPassword(false);
    } catch (err: unknown) {
      setErrorAdmin(err instanceof Error ? err.message : "Error");
    } finally {
      setGuardandoPassword(false);
    }
  }

  if (cargandoEmpresa) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Link href="/admin/empresas" className="hover:text-gray-700 transition-colors">
            Empresas
          </Link>
          <span>/</span>
          <span className="text-gray-700 font-medium">Cargando…</span>
        </div>
        <div className="py-16 text-center text-gray-400 text-sm animate-pulse">
          Cargando empresa…
        </div>
      </div>
    );
  }

  if (error && !form.nombre_empresa) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Link href="/admin/empresas" className="hover:text-gray-700 transition-colors">
            Empresas
          </Link>
          <span>/</span>
          <span className="text-gray-700 font-medium">Error</span>
        </div>
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
          {error}
        </div>
        <Link
          href="/admin/empresas"
          className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-800"
        >
          ← Volver a empresas
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <Link href="/admin/empresas" className="hover:text-gray-700 transition-colors">
          Empresas
        </Link>
        <span>/</span>
        <Link href={`/admin/empresas/${id}`} className="hover:text-gray-700 transition-colors">
          {form.nombre_empresa || "Empresa"}
        </Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Editar</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-gray-900">Editar empresa</h1>
        <p className="text-sm text-gray-500 mt-1">
          Modificar datos de la empresa y módulos habilitados.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8 max-w-2xl">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
            {error}
          </div>
        )}

        <section className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center gap-2 mb-5 pb-2 border-b border-gray-100">
            <span className="text-base">🏢</span>
            <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider">
              Datos de la empresa
            </h3>
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

        {/* Administrador de la empresa */}
        <section className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center gap-2 mb-5 pb-2 border-b border-gray-100">
            <span className="text-base">👤</span>
            <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider">
              Administrador de la empresa
            </h3>
          </div>
          {!admin ? (
            <p className="text-sm text-gray-500">No hay administrador asociado a esta empresa.</p>
          ) : editandoAdmin ? (
            <form onSubmit={handleGuardarAdmin} className="space-y-4">
              {errorAdmin && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                  {errorAdmin}
                </div>
              )}
              <div>
                <label className={fLabel}>Nombre</label>
                <input
                  type="text"
                  value={adminForm.nombre}
                  onChange={(e) => setAdminForm((p) => ({ ...p, nombre: e.target.value.toUpperCase() }))}
                  className={`${fInput} uppercase`}
                  placeholder="Nombre completo"
                />
              </div>
              <div>
                <label className={fLabel}>Email</label>
                <input
                  type="email"
                  value={adminForm.email}
                  onChange={(e) => setAdminForm((p) => ({ ...p, email: e.target.value.toLowerCase() }))}
                  className={fInput}
                  placeholder="admin@empresa.com"
                />
              </div>
              <div>
                <label className={fLabel}>Estado</label>
                <select
                  value={adminForm.estado}
                  onChange={(e) =>
                    setAdminForm((p) => ({ ...p, estado: e.target.value as "activo" | "inactivo" }))
                  }
                  className={fInput}
                >
                  <option value="activo">Activo</option>
                  <option value="inactivo">Inactivo</option>
                </select>
              </div>
              <div>
                <label className={fLabel}>Módulos visibles para este usuario</label>
                <p className="text-xs text-slate-500 mb-2">
                  Solo se muestran módulos habilitados para la empresa. Sin selección = ve todos los de la empresa.
                </p>
                {cargandoModulos ? (
                  <p className="text-sm text-gray-400">Cargando…</p>
                ) : (() => {
                  const modulosEmpresa = modulos.filter((m) => form.modulo_ids.includes(m.id));
                  return modulosEmpresa.length === 0 ? (
                    <p className="text-sm text-gray-400">Habilitá módulos de la empresa primero.</p>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {modulosEmpresa.map((m) => (
                        <label
                          key={m.id}
                          className="flex items-center gap-2 cursor-pointer p-2 rounded-lg hover:bg-gray-50"
                        >
                          <input
                            type="checkbox"
                            checked={
                              adminForm.modulo_ids.length === 0 || adminForm.modulo_ids.includes(m.id)
                            }
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setAdminForm((p) => {
                                const base = p.modulo_ids.length === 0 ? form.modulo_ids : p.modulo_ids;
                                return {
                                  ...p,
                                  modulo_ids: checked
                                    ? [...base.filter((id) => id !== m.id), m.id]
                                    : base.filter((id) => id !== m.id),
                                };
                              });
                            }}
                            className="rounded border-gray-300"
                          />
                          <span className="text-sm">{(m as { nombre?: string; name?: string }).nombre ?? (m as { name?: string }).name ?? m.id}</span>
                        </label>
                      ))}
                    </div>
                  );
                })()}
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={guardandoAdmin}
                  className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
                >
                  {guardandoAdmin ? "Guardando…" : "Guardar"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditandoAdmin(false);
                    setAdminForm({
                      nombre: admin.nombre ?? "",
                      email: admin.email ?? "",
                      estado: (admin.estado as "activo" | "inactivo") ?? "activo",
                      modulo_ids: admin.modulo_ids ?? [],
                    });
                  }}
                  className="border border-slate-200 text-sm px-4 py-2 rounded-lg hover:bg-slate-50"
                >
                  Cancelar
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              {errorAdmin && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                  {errorAdmin}
                </div>
              )}
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-0.5">
                    Nombre
                  </p>
                  <p className="text-sm font-medium text-gray-800">{admin.nombre}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-0.5">
                    Email
                  </p>
                  <p className="text-sm text-gray-700">{admin.email}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-0.5">
                    Rol
                  </p>
                  <p className="text-sm text-gray-700">{admin.rol}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-0.5">
                    Estado
                  </p>
                  <BadgeEstado estado={admin.estado ?? "activo"} />
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setEditandoAdmin(true)}
                  className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
                >
                  Editar nombre / email
                </button>
                <button
                  type="button"
                  onClick={() => setMostrarResetPassword(!mostrarResetPassword)}
                  className="border border-slate-200 text-sm px-4 py-2 rounded-lg hover:bg-slate-50"
                >
                  Resetear contraseña
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const nuevoEstado = admin.estado === "activo" ? "inactivo" : "activo";
                    setErrorAdmin(null);
                    try {
                      await actualizarUsuario(admin.id, {
                        estado: nuevoEstado as "activo" | "inactivo",
                      });
                      setAdmin({ ...admin, estado: nuevoEstado });
                    } catch (err: unknown) {
                      setErrorAdmin(err instanceof Error ? err.message : "Error");
                    }
                  }}
                  className="border border-slate-200 text-sm px-4 py-2 rounded-lg hover:bg-slate-50"
                >
                  {admin.estado === "activo" ? "Desactivar" : "Activar"} usuario
                </button>
              </div>
              {mostrarResetPassword && (
                <form
                  onSubmit={handleResetPassword}
                  className="mt-4 p-4 bg-slate-50 rounded-lg border border-slate-200"
                >
                  <label className={fLabel}>Nueva contraseña (mín. 6 caracteres)</label>
                  <div className="flex gap-2 mt-2">
                    <input
                      type="password"
                      value={nuevaPassword}
                      onChange={(e) => setNuevaPassword(e.target.value)}
                      className={fInput}
                      placeholder="••••••••"
                      minLength={6}
                    />
                    <button
                      type="submit"
                      disabled={guardandoPassword || nuevaPassword.length < 6}
                      className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50 shrink-0"
                    >
                      {guardandoPassword ? "Guardando…" : "Aplicar"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMostrarResetPassword(false);
                        setNuevaPassword("");
                      }}
                      className="border border-slate-200 text-sm px-4 py-2 rounded-lg hover:bg-slate-50"
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </section>

        <section className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center gap-2 mb-5 pb-2 border-b border-gray-100">
            <span className="text-base">📦</span>
            <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider">
              Módulos habilitados
            </h3>
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
          <p className="text-xs text-slate-500 mb-3 max-w-2xl">
            Pestañas del tablero principal disponibles para la empresa. Los usuarios solo podrán asignarse vistas
            incluidas aquí.
          </p>
          {cargandoModulos ? (
            <p className="text-sm text-gray-400">Cargando…</p>
          ) : dashCatalog.length === 0 ? (
            <p className="text-sm text-gray-400">No hay vistas en el catálogo.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {dashCatalog.map((d) => (
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
            {guardando ? "Guardando…" : "Guardar cambios"}
          </button>
          <Link
            href={`/admin/empresas/${id}`}
            className="border border-slate-200 text-sm px-6 py-2.5 rounded-lg hover:bg-slate-50 transition-colors inline-flex items-center"
          >
            Cancelar
          </Link>
        </div>
      </form>
    </div>
  );
}
