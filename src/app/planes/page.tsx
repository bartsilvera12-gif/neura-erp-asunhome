"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getPlanes, toggleEstadoPlan } from "@/lib/planes/storage";
import type { Plan } from "@/lib/planes/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatGs(n: number) {
  return n.toLocaleString("es-PY");
}

function formatPrecio(p: Plan) {
  if (p.moneda === "USD") return `USD ${p.precio.toLocaleString("en-US")}`;
  return `Gs. ${formatGs(p.precio)}`;
}

function limiteLabel(v: number | null) {
  return v === null ? "Ilimitado" : v.toLocaleString("es-PY");
}

// ── Badges ────────────────────────────────────────────────────────────────────

function BadgeEstado({ estado }: { estado: Plan["estado"] }) {
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
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
    mensual: "bg-blue-50  text-blue-600  border-blue-100",
    anual:   "bg-violet-50 text-violet-600 border-violet-100",
    unico:   "bg-amber-50 text-amber-600  border-amber-100",
  };
  const label = { mensual: "Mensual", anual: "Anual", unico: "Único" };
  return (
    <span className={`text-xs px-2 py-0.5 rounded border ${cfg[p]}`}>
      {label[p]}
    </span>
  );
}

// ── Página ────────────────────────────────────────────────────────────────────

export default function PlanesPage() {
  const [planes,    setPlanes]    = useState<Plan[]>([]);
  const [busqueda,  setBusqueda]  = useState("");
  const [filtroEst, setFiltroEst] = useState<"" | "activo" | "inactivo">("");
  const [filtroPer, setFiltroPer] = useState<"" | "mensual" | "anual" | "unico">("");

  useEffect(() => {
    let cancelled = false;
    getPlanes().then((data) => {
      if (!cancelled) setPlanes(data);
    });
    return () => { cancelled = true; };
  }, []);

  const filtrados = planes.filter((p) => {
    const q = busqueda.toLowerCase();
    if (q) {
      const campos = [
        p.codigo_plan, p.nombre, p.descripcion ?? "",
        p.periodicidad, p.moneda,
        formatPrecio(p),
      ].join(" ").toLowerCase();
      if (!campos.includes(q)) return false;
    }
    if (filtroEst && p.estado       !== filtroEst) return false;
    if (filtroPer && p.periodicidad !== filtroPer) return false;
    return true;
  });

  async function handleToggleEstado(plan: Plan) {
    const nuevo = plan.estado === "activo" ? "inactivo" : "activo";
    await toggleEstadoPlan(plan.id, nuevo);
    getPlanes().then(setPlanes);
  }

  return (
    <div className="space-y-6">

      {/* Encabezado */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Planes</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Gestión de planes disponibles del sistema
          </p>
        </div>
        <Link
          href="/planes/nuevo"
          className="inline-flex items-center gap-2 bg-[#0EA5E9] hover:bg-[#0284C7] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors shadow-sm"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
          </svg>
          Nuevo plan
        </Link>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z" clipRule="evenodd" />
          </svg>
          <input
            type="text"
            placeholder="Buscar por nombre, código…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0EA5E9] bg-white"
          />
        </div>

        <select
          value={filtroEst}
          onChange={(e) => setFiltroEst(e.target.value as typeof filtroEst)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#0EA5E9] bg-white"
        >
          <option value="">Todos los estados</option>
          <option value="activo">Activo</option>
          <option value="inactivo">Inactivo</option>
        </select>

        <select
          value={filtroPer}
          onChange={(e) => setFiltroPer(e.target.value as typeof filtroPer)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#0EA5E9] bg-white"
        >
          <option value="">Todas las periodicidades</option>
          <option value="mensual">Mensual</option>
          <option value="anual">Anual</option>
          <option value="unico">Único</option>
        </select>

        {(busqueda || filtroEst || filtroPer) && (
          <button
            onClick={() => { setBusqueda(""); setFiltroEst(""); setFiltroPer(""); }}
            className="text-sm text-gray-400 hover:text-gray-700 transition-colors px-2 py-1"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {/* Contador */}
      <p className="text-sm text-gray-500">
        <span className="font-semibold text-gray-700">{filtrados.length}</span> de{" "}
        <span className="font-semibold text-gray-700">{planes.length}</span> planes
      </p>

      {/* Tabla — overflow-x-auto + min-w fuerzan scroll horizontal en mobile;
          columnas Codigo/Usuarios/Clientes/Facturas se ocultan progresivamente. */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        {filtrados.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">
            No se encontraron planes con los filtros aplicados.
          </div>
        ) : (
          <table className="w-full min-w-[960px] sm:min-w-0 text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left text-sm font-semibold text-slate-600 px-4 py-3 uppercase tracking-wide whitespace-nowrap hidden lg:table-cell">Código</th>
                <th className="text-left text-sm font-semibold text-slate-600 px-4 py-3 uppercase tracking-wide whitespace-nowrap">Nombre</th>
                <th className="text-left text-sm font-semibold text-slate-600 px-4 py-3 uppercase tracking-wide whitespace-nowrap">Precio</th>
                <th className="text-left text-sm font-semibold text-slate-600 px-4 py-3 uppercase tracking-wide whitespace-nowrap hidden md:table-cell">Periodicidad</th>
                <th className="text-left text-sm font-semibold text-slate-600 px-4 py-3 uppercase tracking-wide whitespace-nowrap hidden lg:table-cell">Usuarios</th>
                <th className="text-left text-sm font-semibold text-slate-600 px-4 py-3 uppercase tracking-wide whitespace-nowrap hidden lg:table-cell">Clientes</th>
                <th className="text-left text-sm font-semibold text-slate-600 px-4 py-3 uppercase tracking-wide whitespace-nowrap hidden lg:table-cell">Facturas</th>
                <th className="text-left text-sm font-semibold text-slate-600 px-4 py-3 uppercase tracking-wide whitespace-nowrap hidden md:table-cell">Estado</th>
                <th className="text-left text-sm font-semibold text-slate-600 px-4 py-3 uppercase tracking-wide whitespace-nowrap">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filtrados.map((plan) => (
                <tr
                  key={plan.id}
                  className={`border-b border-slate-200 hover:bg-slate-50 transition-colors ${plan.estado === "inactivo" ? "opacity-60" : ""}`}
                >
                  {/* Código */}
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-gray-600 whitespace-nowrap hidden lg:table-cell">
                    {plan.codigo_plan}
                  </td>
                  {/* Nombre */}
                  <td className="px-4 py-3">
                    <p className="font-semibold text-gray-800">{plan.nombre}</p>
                    {plan.descripcion && (
                      <p className="text-xs text-gray-400 mt-0.5 truncate max-w-[200px]" title={plan.descripcion}>
                        {plan.descripcion}
                      </p>
                    )}
                  </td>
                  {/* Precio */}
                  <td className="px-4 py-3 tabular-nums font-semibold text-gray-800 whitespace-nowrap">
                    {formatPrecio(plan)}
                  </td>
                  {/* Periodicidad */}
                  <td className="px-4 py-3 hidden md:table-cell">
                    <BadgePeriodicidad p={plan.periodicidad} />
                  </td>
                  {/* Límites */}
                  <td className="px-4 py-3 text-xs text-gray-600 tabular-nums hidden lg:table-cell">
                    {limiteLabel(plan.limite_usuarios)}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600 tabular-nums hidden lg:table-cell">
                    {limiteLabel(plan.limite_clientes)}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600 tabular-nums hidden lg:table-cell">
                    {limiteLabel(plan.limite_facturas)}
                  </td>
                  {/* Estado */}
                  <td className="px-4 py-3 hidden md:table-cell">
                    <BadgeEstado estado={plan.estado} />
                  </td>
                  {/* Acciones */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {/* Ver */}
                      <Link
                        href={`/planes/${plan.id}`}
                        title="Ver plan"
                        className="inline-flex items-center justify-center min-w-[40px] min-h-[40px] rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                          <path d="M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
                          <path fillRule="evenodd" d="M.664 10.59a1.651 1.651 0 0 1 0-1.186A10.004 10.004 0 0 1 10 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0 1 10 17c-4.257 0-7.893-2.66-9.336-6.41ZM14 10a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" clipRule="evenodd" />
                        </svg>
                      </Link>
                      {/* Editar */}
                      <Link
                        href={`/planes/${plan.id}?edit=1`}
                        title="Editar plan"
                        className="inline-flex items-center justify-center min-w-[40px] min-h-[40px] rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                          <path d="M2.695 14.763l-1.262 3.154a.5.5 0 0 0 .65.65l3.155-1.262a4 4 0 0 0 1.343-.885L17.5 5.5a2.121 2.121 0 0 0-3-3L3.58 13.42a4 4 0 0 0-.885 1.343Z" />
                        </svg>
                      </Link>
                      {/* Activar / Desactivar */}
                      <button
                        type="button"
                        title={plan.estado === "activo" ? "Desactivar plan" : "Activar plan"}
                        onClick={() => handleToggleEstado(plan)}
                        className={`inline-flex items-center justify-center min-w-[40px] min-h-[40px] rounded-lg transition-colors ${
                          plan.estado === "activo"
                            ? "text-gray-400 hover:text-red-600 hover:bg-red-50"
                            : "text-gray-400 hover:text-green-600 hover:bg-green-50"
                        }`}
                      >
                        {plan.estado === "activo" ? (
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                            <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM8.28 7.22a.75.75 0 0 0-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 1 0 1.06 1.06L10 11.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L11.06 10l1.72-1.72a.75.75 0 0 0-1.06-1.06L10 8.94 8.28 7.22Z" clipRule="evenodd" />
                          </svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                            <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clipRule="evenodd" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

    </div>
  );
}
