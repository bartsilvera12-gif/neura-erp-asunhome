"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getEmpresaById } from "@/lib/empresas/actions";
import type { EmpresaDetalle } from "@/lib/empresas/actions";

function formatFecha(iso: string) {
  try {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  } catch {
    return "";
  }
}

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

export default function VerEmpresaPage() {
  const params = useParams();
  const id = String(params?.id ?? "");
  const [data, setData] = useState<EmpresaDetalle | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getEmpresaById(id)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Error"))
      .finally(() => setCargando(false));
  }, [id]);

  if (cargando) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Link href="/admin/empresas" className="hover:text-gray-700 transition-colors">
            Empresas
          </Link>
          <span>/</span>
          <span className="text-gray-700 font-medium">Cargando…</span>
        </div>
        <div className="py-16 text-center text-gray-400 text-sm animate-pulse">Cargando empresa…</div>
      </div>
    );
  }

  if (error || !data) {
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
          {error ?? "Empresa no encontrada"}
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

  const { empresa, usuarios, modulos } = data;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <Link href="/admin/empresas" className="hover:text-gray-700 transition-colors">
          Empresas
        </Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">{empresa.nombre_empresa}</span>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{empresa.nombre_empresa}</h1>
          <p className="text-sm text-gray-500 mt-1">Detalle de la empresa</p>
        </div>
        <Link
          href={`/admin/empresas/${id}/editar`}
          className="flex items-center gap-1.5 bg-[#0EA5E9] hover:bg-[#0284C7] text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors shadow-sm shrink-0 active:scale-95"
        >
          Editar
        </Link>
      </div>

      <div className="grid gap-6">
        {/* Datos principales */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-200 bg-slate-50">
            <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">
              Datos de la empresa
            </h2>
          </div>
          <div className="p-5 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-0.5">
                Nombre
              </p>
              <p className="text-sm font-medium text-gray-800">{empresa.nombre_empresa}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-0.5">
                RUC
              </p>
              <p className="text-sm text-gray-700">{empresa.ruc ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-0.5">
                Plan
              </p>
              <p className="text-sm text-gray-700">{empresa.plan ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-0.5">
                Estado
              </p>
              <BadgeEstado estado={empresa.estado} />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-0.5">
                Fecha de creación
              </p>
              <p className="text-sm text-gray-700">{formatFecha(empresa.created_at)}</p>
            </div>
          </div>
        </div>

        {/* Módulos habilitados */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-200 bg-slate-50">
            <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">
              Módulos habilitados
            </h2>
          </div>
          <div className="p-5">
            {modulos.length === 0 ? (
              <p className="text-sm text-gray-500">Ningún módulo habilitado</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {modulos.map((m) => (
                  <span
                    key={m.id}
                    className="inline-flex items-center px-3 py-1 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium"
                  >
                    {m.nombre}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Usuarios */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-200 bg-slate-50">
            <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">
              Usuarios de la empresa
            </h2>
          </div>
          {usuarios.length === 0 ? (
            <div className="p-5">
              <p className="text-sm text-gray-500">No hay usuarios registrados</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="text-left text-sm font-semibold text-slate-600 px-5 py-3">
                    Nombre
                  </th>
                  <th className="text-left text-sm font-semibold text-slate-600 px-5 py-3">Email</th>
                  <th className="text-left text-sm font-semibold text-slate-600 px-5 py-3">Rol</th>
                  <th className="text-left text-sm font-semibold text-slate-600 px-5 py-3">
                    Registrado
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {usuarios.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3.5 text-sm font-medium text-gray-800">{u.nombre}</td>
                    <td className="px-5 py-3.5 text-sm text-gray-600">{u.email}</td>
                    <td className="px-5 py-3.5 text-sm text-gray-600">{u.rol ?? "—"}</td>
                    <td className="px-5 py-3.5 text-xs text-gray-400">
                      {formatFecha(u.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
