"use client";

/**
 * Pantalla de maestro simple para Marcas y Líneas de producto.
 *
 * Las dos son la misma tabla con distinto nombre; Marcas además permite elegir
 * el proveedor habitual, que es lo que alimenta el reporte por proveedor.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  getMaestros,
  crearMaestro,
  actualizarMaestro,
  borrarMaestro,
  type Maestro,
  type MaestroKind,
} from "@/lib/inventario/maestros";

const inputClass =
  "w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#0EA5E9] outline-none";

interface ProveedorOpt {
  id: string;
  nombre: string;
}

export default function MaestroProductoPage(props: {
  kind: MaestroKind;
  titulo: string;
  descripcion: string;
  placeholderNombre: string;
  /** Marcas muestra selector de proveedor habitual; líneas no. */
  conProveedor?: boolean;
}) {
  const { kind, titulo, descripcion, placeholderNombre, conProveedor = false } = props;

  const [lista, setLista] = useState<Maestro[]>([]);
  const [proveedores, setProveedores] = useState<ProveedorOpt[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");

  const [nombre, setNombre] = useState("");
  const [codigo, setCodigo] = useState("");
  const [proveedorId, setProveedorId] = useState("");

  const [editId, setEditId] = useState<string | null>(null);
  const [eNombre, setENombre] = useState("");
  const [eCodigo, setECodigo] = useState("");
  const [eProveedorId, setEProveedorId] = useState("");
  const [borrandoId, setBorrandoId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setCargando(true);
    setLista(await getMaestros(kind, { todas: true }));
    setCargando(false);
  }, [kind]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!conProveedor) return;
    let cancel = false;
    (async () => {
      try {
        const r = await fetch("/api/proveedores", { credentials: "include", cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        const filas = (j?.data?.proveedores ?? j?.data ?? []) as ProveedorOpt[];
        if (!cancel && Array.isArray(filas)) setProveedores(filas);
      } catch {
        /* el selector queda vacío; no bloquea la carga de marcas */
      }
    })();
    return () => {
      cancel = true;
    };
  }, [conProveedor]);

  async function handleCrear(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!nombre.trim()) return;
    const res = await crearMaestro(kind, {
      nombre: nombre.trim(),
      codigo: codigo.trim() || null,
      proveedor_id: conProveedor ? proveedorId || null : null,
    });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setNombre("");
    setCodigo("");
    setProveedorId("");
    await reload();
  }

  function startEdit(m: Maestro) {
    setEditId(m.id);
    setENombre(m.nombre);
    setECodigo(m.codigo ?? "");
    setEProveedorId(m.proveedor_id ?? "");
    setError(null);
  }

  async function saveEdit() {
    if (!editId || !eNombre.trim()) return;
    const res = await actualizarMaestro(kind, editId, {
      nombre: eNombre.trim(),
      codigo: eCodigo.trim() || null,
      proveedor_id: conProveedor ? eProveedorId || null : undefined,
    });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setEditId(null);
    await reload();
  }

  async function toggleActivo(m: Maestro) {
    const res = await actualizarMaestro(kind, m.id, { activo: !m.activo });
    if (!res.ok) setError(res.error);
    else await reload();
  }

  async function handleBorrar(m: Maestro) {
    const aviso =
      m.productos > 0
        ? `"${m.nombre}" está asignada a ${m.productos} producto(s). Si la borrás, esos productos quedan sin ${conProveedor ? "marca" : "línea"} (no se pierden).\n\n¿Continuar?`
        : `¿Borrar "${m.nombre}"?`;
    if (!window.confirm(aviso)) return;
    setBorrandoId(m.id);
    try {
      const res = await borrarMaestro(kind, m.id);
      if (!res.ok) setError(res.error);
      else await reload();
    } finally {
      setBorrandoId(null);
    }
  }

  const filtrada = lista.filter((m) => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return true;
    return (
      m.nombre.toLowerCase().includes(q) ||
      (m.codigo ?? "").toLowerCase().includes(q) ||
      (m.proveedor_nombre ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-4 pb-10 sm:px-6 lg:px-8">
      <div>
        <Link href="/inventario" className="text-sm text-sky-600 hover:underline">← Inventario</Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">{titulo}</h1>
        <p className="text-sm text-slate-600">{descripcion}</p>
      </div>

      <form onSubmit={handleCrear} className="max-w-2xl space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-800">Nueva {conProveedor ? "marca" : "línea"}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Código</label>
            <input className={`${inputClass} uppercase`} value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Opcional" maxLength={30} />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-slate-600">Nombre *</label>
            <input className={inputClass} value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder={placeholderNombre} required />
          </div>
        </div>
        {conProveedor && (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Proveedor habitual</label>
            <select className={inputClass} value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
              <option value="">Sin proveedor</option>
              {proveedores.map((p) => (
                <option key={p.id} value={p.id}>{p.nombre}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              Sirve para rastrear de qué proveedor vino un equipo averiado de esta marca.
            </p>
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" className="rounded-lg bg-[#0EA5E9] px-4 py-2 text-sm font-medium text-white hover:bg-[#0284C7]">
          Crear
        </button>
      </form>

      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <input
            className={`${inputClass} max-w-xs`}
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar…"
          />
          <span className="shrink-0 text-xs text-slate-500">
            {filtrada.length} de {lista.length}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-slate-600">
                <th className="py-3 pr-4 font-semibold">Código</th>
                <th className="py-3 pr-4 font-semibold">Nombre</th>
                {conProveedor && <th className="py-3 pr-4 font-semibold">Proveedor habitual</th>}
                <th className="py-3 pr-4 font-semibold">Productos</th>
                <th className="py-3 pr-4 font-semibold">Activo</th>
                <th className="py-3 font-semibold">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtrada.map((m) => (
                <tr key={m.id} className="border-b border-slate-50">
                  <td className="py-3 pr-4">
                    {editId === m.id ? (
                      <input className={`${inputClass} uppercase`} value={eCodigo} onChange={(e) => setECodigo(e.target.value)} />
                    ) : (
                      <span className="font-mono text-xs text-slate-500">{m.codigo ?? "—"}</span>
                    )}
                  </td>
                  <td className="py-3 pr-4">
                    {editId === m.id ? (
                      <input className={inputClass} value={eNombre} onChange={(e) => setENombre(e.target.value)} />
                    ) : (
                      <span className="font-medium text-slate-900">{m.nombre}</span>
                    )}
                  </td>
                  {conProveedor && (
                    <td className="py-3 pr-4">
                      {editId === m.id ? (
                        <select className={inputClass} value={eProveedorId} onChange={(e) => setEProveedorId(e.target.value)}>
                          <option value="">Sin proveedor</option>
                          {proveedores.map((p) => (
                            <option key={p.id} value={p.id}>{p.nombre}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-slate-600">{m.proveedor_nombre ?? "—"}</span>
                      )}
                    </td>
                  )}
                  <td className="py-3 pr-4 tabular-nums text-slate-600">{m.productos}</td>
                  <td className="py-3 pr-4">
                    <button
                      type="button"
                      onClick={() => void toggleActivo(m)}
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${m.activo ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}
                    >
                      {m.activo ? "Sí" : "No"}
                    </button>
                  </td>
                  <td className="py-3">
                    {editId === m.id ? (
                      <div className="flex gap-3">
                        <button type="button" onClick={() => void saveEdit()} className="font-medium text-sky-600 hover:underline">Guardar</button>
                        <button type="button" onClick={() => setEditId(null)} className="text-slate-500 hover:underline">Cancelar</button>
                      </div>
                    ) : (
                      <div className="flex gap-3">
                        <button type="button" onClick={() => startEdit(m)} className="font-medium text-sky-600 hover:underline">Editar</button>
                        <button
                          type="button"
                          onClick={() => void handleBorrar(m)}
                          disabled={borrandoId === m.id}
                          className="font-medium text-rose-600 hover:underline disabled:opacity-50"
                        >
                          {borrandoId === m.id ? "Borrando…" : "Borrar"}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!cargando && filtrada.length === 0 && (
          <p className="py-8 text-center text-slate-400">
            {lista.length === 0 ? "Todavía no cargaste ninguna." : "Sin resultados para esa búsqueda."}
          </p>
        )}
        {cargando && <p className="py-8 text-center text-slate-400">Cargando…</p>}
      </div>
    </div>
  );
}
