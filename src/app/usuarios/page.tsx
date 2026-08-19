"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type UsuarioRow = {
  id: string;
  nombre: string | null;
  email: string;
  telefono: string | null;
  rol: string | null;
  estado: string | null;
  created_at: string;
};

const AVATAR_COLORS = ["bg-violet-500", "bg-blue-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500", "bg-sky-500"];
function avatarColor(id: string) {
  return AVATAR_COLORS[Math.abs(id.split("").reduce((a, c) => a + c.charCodeAt(0), 0)) % AVATAR_COLORS.length];
}
function getInitials(nombre: string) {
  return (nombre || "?")
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase() || "?";
}

export default function UsuariosPage() {
  const [usuarios, setUsuarios] = useState<UsuarioRow[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");

  useEffect(() => {
    fetchWithSupabaseSession("/api/empresas/usuarios", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setUsuarios(data.usuarios ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Error"))
      .finally(() => setCargando(false));
  }, []);

  const filtrados = usuarios.filter((u) => {
    const q = busqueda.toLowerCase();
    if (!q) return true;
    const texto = [u.nombre ?? "", u.email, u.telefono ?? ""].join(" ").toLowerCase();
    return texto.includes(q);
  });

  if (cargando) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Usuarios</h1>
        <div className="py-16 text-center text-sm text-gray-400 animate-pulse">Cargando…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Usuarios</h1>
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Usuarios</h1>
          <p className="text-sm text-gray-500 mt-0.5">Usuarios de tu empresa</p>
        </div>
        <Link
          href="/usuarios/nuevo"
          className="inline-flex items-center gap-2 bg-[#0EA5E9] hover:bg-[#0284C7] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors shadow-sm active:scale-95"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
          </svg>
          Nuevo usuario
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        <input
          type="text"
          placeholder="Buscar por nombre, email, teléfono…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="w-full max-w-md pl-4 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0EA5E9]"
        />
      </div>

      <p className="text-sm text-gray-500">
        <span className="font-semibold text-gray-700">{filtrados.length}</span> de{" "}
        <span className="font-semibold text-gray-700">{usuarios.length}</span> usuarios
      </p>

      {/* overflow-x-auto en el wrapper en lugar de overflow-hidden:
          - mobile: tabla con min-w-[820px] activa scroll horizontal real.
          - Teléfono se oculta en pantallas chicas (ya esta en el bloque del usuario debajo del nombre).
          - Acciones con min-h-[40px] para tap target.
      */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm ring-1 ring-[#4FAEB2]/15 overflow-x-auto">
        {filtrados.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">No hay usuarios.</div>
        ) : (
          <table className="w-full min-w-[820px] sm:min-w-0 text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3 uppercase tracking-wide">Usuario</th>
                <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3 uppercase tracking-wide">Email</th>
                <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3 uppercase tracking-wide hidden md:table-cell">Teléfono</th>
                <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3 uppercase tracking-wide">Rol</th>
                <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3 uppercase tracking-wide hidden md:table-cell">Estado</th>
                <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3 uppercase tracking-wide">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filtrados.map((usr) => (
                <tr key={usr.id} className={`hover:bg-[#4FAEB2]/[0.04] transition-colors ${usr.estado === "inactivo" ? "opacity-60" : ""}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 ${avatarColor(usr.id)}`}
                      >
                        {getInitials(usr.nombre ?? usr.email)}
                      </div>
                      <div>
                        <p className="font-semibold text-gray-800 truncate max-w-[180px]">{usr.nombre ?? "—"}</p>
                        {usr.telefono && <p className="text-xs text-gray-400">{usr.telefono}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600 truncate max-w-[180px]">{usr.email}</td>
                  <td className="px-4 py-3 text-gray-600 hidden md:table-cell">{usr.telefono ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-medium text-gray-600 capitalize">{usr.rol ?? "—"}</span>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span
                      className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
                        usr.estado === "activo" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {usr.estado ?? "activo"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Link
                        href={`/usuarios/${usr.id}`}
                        title="Ver usuario"
                        className="inline-flex items-center justify-center min-w-[40px] min-h-[40px] rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                          <path d="M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
                        </svg>
                      </Link>
                      <Link
                        href={`/usuarios/${usr.id}?edit=1`}
                        title="Editar usuario"
                        className="inline-flex items-center justify-center min-w-[40px] min-h-[40px] rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                          <path d="M2.695 14.763l-1.262 3.154a.5.5 0 0 0 .65.65l3.155-1.262a4 4 0 0 0 1.343-.885L17.5 5.5a2.121 2.121 0 0 0-3-3L3.58 13.42a4 4 0 0 0-.885 1.343Z" />
                        </svg>
                      </Link>
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
