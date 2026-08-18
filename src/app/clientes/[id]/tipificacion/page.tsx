"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getCliente, clienteNombre } from "@/lib/clientes/storage";
import { getTipificaciones, saveTipificacion } from "@/lib/gestion-clientes/storage";
import { useAutoClearFlag } from "@/hooks/useAutoClearFlag";
import type { Cliente } from "@/lib/clientes/types";
import type { Tipificacion, TipoGestion, ResultadoTipificacion } from "@/lib/gestion-clientes/types";

// ── Constantes ────────────────────────────────────────────────────────────────

const TIPOS_GESTION: TipoGestion[] = [
  "Consulta",
  "Reclamo",
  "Seguimiento",
  "Promesa de pago",
  "Soporte técnico",
  "Cambio plan",
];

const RESULTADOS: ResultadoTipificacion[] = ["Pendiente", "Resuelto", "Escalar"];

const USUARIO_DEFAULT = "ADMINISTRADOR";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatFechaHora(iso: string) {
  try {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch { return ""; }
}

// ── Badges ────────────────────────────────────────────────────────────────────

function BadgeResultado({ resultado }: { resultado: ResultadoTipificacion }) {
  const cfg: Record<ResultadoTipificacion, string> = {
    Pendiente: "bg-amber-100 text-amber-700",
    Resuelto:  "bg-green-100 text-green-700",
    Escalar:   "bg-red-100 text-red-700",
  };
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cfg[resultado]}`}>
      {resultado}
    </span>
  );
}

function BadgeTipo({ tipo }: { tipo: TipoGestion }) {
  return (
    <span className="text-xs font-medium bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full border border-blue-100">
      {tipo}
    </span>
  );
}

// ── Componente ────────────────────────────────────────────────────────────────

export default function TipificacionPage() {
  const params = useParams();
  const router = useRouter();
  if (!params) return null;
  const id = params.id as string;

  const [cliente,        setCliente]        = useState<Cliente | null>(null);
  const [notFound,       setNotFound]       = useState(false);
  const [tipificaciones, setTipificaciones] = useState<Tipificacion[]>([]);
  // useAutoClearFlag(3000): se desactiva solo a los 3s con cleanup en unmount.
  const [exitoValue, setExitoFlag] = useAutoClearFlag<true>(3000);
  const exito = exitoValue === true;
  const setExito = (v: boolean) => setExitoFlag(v ? true : null);

  const [form, setForm] = useState<{
    tipo_gestion: TipoGestion;
    resultado:    ResultadoTipificacion;
    observacion:  string;
  }>({
    tipo_gestion: "Consulta",
    resultado:    "Pendiente",
    observacion:  "",
  });

  const [error, setError] = useState<string | null>(null);

  async function cargar() {
    const c = await getCliente(id);
    if (!c) { setNotFound(true); return; }
    setCliente(c);
    const tips = await getTipificaciones(id);
    setTipificaciones(tips);
  }

  useEffect(() => {
    if (id) void cargar();
    else setNotFound(true);
  }, [id]);

  function handleChange(
    e: React.ChangeEvent<HTMLSelectElement | HTMLTextAreaElement>
  ) {
    setError(null);
    setExito(false);
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handleGuardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setExito(false);

    if (!form.observacion.trim()) {
      return setError("La observación es obligatoria.");
    }

    const guardado = await saveTipificacion({
      cliente_id:   id,
      usuario:      USUARIO_DEFAULT,
      tipo_gestion: form.tipo_gestion,
      resultado:    form.resultado,
      observacion:  form.observacion.trim(),
    });

    if (guardado) {
      setForm({ tipo_gestion: "Consulta", resultado: "Pendiente", observacion: "" });
      setExito(true);
      cargar();
      // El timer de 3s lo arma useAutoClearFlag (cancelado en unmount).
    } else {
      setError("Error al guardar la tipificación.");
    }
  }

  if (notFound) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-gray-800">Cliente no encontrado</h1>
        <button onClick={() => router.push("/clientes")} className="text-sm text-gray-500 underline">
          ← Volver a Clientes
        </button>
      </div>
    );
  }

  if (!cliente) return null;

  return (
    <div className="space-y-6 max-w-4xl">

      {/* ── Breadcrumb ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <button onClick={() => router.push("/gestion-clientes")} className="hover:text-gray-600 transition-colors">
          Gestión de clientes
        </button>
        <span>›</span>
        <button onClick={() => router.push(`/clientes/${id}`)} className="hover:text-gray-600 transition-colors">
          {clienteNombre(cliente)}
        </button>
        <span>›</span>
        <span className="text-gray-600 font-medium">Tipificación</span>
      </div>

      {/* ── Header del cliente ────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{clienteNombre(cliente)}</h1>
            <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
              <span className="font-mono">{cliente.codigo_cliente}</span>
              {cliente.ruc && <span>RUC: {cliente.ruc}</span>}
              {cliente.telefono && <span>Tel: {cliente.telefono}</span>}
              {cliente.email && <span>{cliente.email}</span>}
            </div>
          </div>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
            cliente.estado === "activo" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
          }`}>
            {cliente.estado === "activo" ? "● Activo" : "● Inactivo"}
          </span>
        </div>
      </div>

      {/* ── Formulario de nueva tipificación ─────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="bg-gray-50 border-b border-gray-200 px-6 py-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
            Nueva tipificación
          </p>
        </div>

        <form onSubmit={handleGuardar} className="p-6">
          <div className="grid grid-cols-2 gap-4 mb-4">

            {/* Tipo de gestión */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Tipo de gestión <span className="text-red-500">*</span>
              </label>
              <select
                name="tipo_gestion"
                value={form.tipo_gestion}
                onChange={handleChange}
                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-gray-500 transition-colors bg-white"
              >
                {TIPOS_GESTION.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            {/* Resultado */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Resultado <span className="text-red-500">*</span>
              </label>
              <select
                name="resultado"
                value={form.resultado}
                onChange={handleChange}
                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-gray-500 transition-colors bg-white"
              >
                {RESULTADOS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Observación */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Observación <span className="text-red-500">*</span>
            </label>
            <textarea
              name="observacion"
              value={form.observacion}
              onChange={handleChange}
              rows={3}
              placeholder="Describí la gestión realizada con el cliente..."
              className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm outline-none focus:border-gray-500 transition-colors resize-none"
            />
          </div>

          {/* Aviso usuario */}
          <p className="text-xs text-gray-400 mb-4">
            👤 Se registrará como: <span className="font-semibold text-gray-600">{USUARIO_DEFAULT}</span>
          </p>

          {/* Error / Éxito */}
          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 mb-4">
              <span>⚠</span><span className="font-medium">{error}</span>
            </div>
          )}

          {exito && (
            <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2.5 text-sm text-green-700 font-medium mb-4">
              ✓ Tipificación registrada correctamente.
            </div>
          )}

          <button
            type="submit"
            className="bg-gray-900 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors"
          >
            Guardar tipificación
          </button>
        </form>
      </div>

      {/* ── Historial de tipificaciones ───────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="bg-gray-50 border-b border-gray-200 px-6 py-3 flex items-center justify-between">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
            Historial de tipificaciones
          </p>
          <span className="text-xs font-bold text-gray-600 bg-white border border-gray-200 px-2 py-0.5 rounded-full">
            {tipificaciones.length}
          </span>
        </div>

        {tipificaciones.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">
            No hay tipificaciones registradas para este cliente.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/40">
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">Fecha</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">Usuario</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">Tipo</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">Resultado</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-5 py-3">Observación</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {tipificaciones.map((t) => (
                  <tr key={t.id} className="hover:bg-gray-50/40 transition-colors">
                    <td className="px-5 py-3 text-xs text-gray-500 whitespace-nowrap">
                      {formatFechaHora(t.fecha)}
                    </td>
                    <td className="px-5 py-3 text-xs font-medium text-gray-700 whitespace-nowrap">
                      {t.usuario}
                    </td>
                    <td className="px-5 py-3">
                      <BadgeTipo tipo={t.tipo_gestion} />
                    </td>
                    <td className="px-5 py-3">
                      <BadgeResultado resultado={t.resultado} />
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-600 max-w-xs">
                      <p className="line-clamp-2" title={t.observacion}>{t.observacion}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}
