"use client";

import { useState } from "react";
import type { PreviewResponse, CommitResponse } from "@/lib/excel/import-types";

interface Props {
  entidad: string;
  previewUrl: string;
  commitUrl: string;
  templateUrl: string;
  /** Si true, muestra checkbox "Crear faltantes" (categoria/proveedor/ubicacion). */
  permiteCrearFaltantes?: boolean;
  onClose?: () => void;
  onCompleted?: () => void;
}

export default function ExcelImportWizard({
  entidad, previewUrl, commitUrl, templateUrl, permiteCrearFaltantes = false,
  onClose, onCompleted,
}: Props) {
  const [step, setStep] = useState<"upload" | "preview" | "done">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [commit, setCommit] = useState<CommitResponse | null>(null);
  const [crearFaltantes, setCrearFaltantes] = useState(false);

  async function handleUpload() {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const fd = new FormData(); fd.append("file", file);
      const r = await fetch(previewUrl, { method: "POST", credentials: "include", body: fd });
      const j = await r.json();
      if (!r.ok || !j?.success) { setError(j?.error ?? `Error ${r.status}`); return; }
      setPreview(j.data as PreviewResponse);
      setStep("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally { setBusy(false); }
  }

  async function handleCommit() {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (permiteCrearFaltantes) fd.append("crear_faltantes", crearFaltantes ? "1" : "0");
      const r = await fetch(commitUrl, { method: "POST", credentials: "include", body: fd });
      const j = await r.json();
      if (!r.ok || !j?.success) { setError(j?.error ?? `Error ${r.status}`); return; }
      setCommit(j.data as CommitResponse);
      setStep("done");
      onCompleted?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center bg-slate-900/60 backdrop-blur-sm pt-16 px-4" onClick={onClose}>
      <div className="w-full max-w-5xl bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">Importar {entidad} desde Excel</h2>
            <p className="text-xs text-slate-400">Paso {step === "upload" ? "1 de 3" : step === "preview" ? "2 de 3" : "3 de 3"}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>}

          {step === "upload" && (
            <div className="space-y-4">
              <div className="text-sm text-slate-600">
                Subí un archivo Excel (.xlsx) o CSV. Máx. 5 MB / 5.000 filas.
                <a href={templateUrl} className="ml-2 inline-flex items-center gap-1 text-sky-700 hover:text-sky-900 underline">
                  Descargar plantilla
                </a>
              </div>
              <input
                type="file"
                accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm"
              />
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={onClose} className="px-4 py-2 text-sm border rounded-lg">Cancelar</button>
                <button onClick={handleUpload} disabled={!file || busy}
                  className="px-4 py-2 text-sm rounded-lg bg-[#0EA5E9] text-white disabled:opacity-50">
                  {busy ? "Analizando..." : "Analizar (preview)"}
                </button>
              </div>
            </div>
          )}

          {step === "preview" && preview && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                <Stat label="Total filas" value={preview.summary.total} color="slate" />
                <Stat label="Insertar" value={preview.summary.insertar} color="green" />
                <Stat label="Actualizar" value={preview.summary.actualizar} color="sky" />
                <Stat label="Omitir" value={preview.summary.omitir} color="amber" />
                <Stat label="Errores" value={preview.summary.errores} color="red" />
              </div>
              {preview.summary.warnings > 0 && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                  {preview.summary.warnings} advertencia(s) — revisá la tabla.
                </div>
              )}
              {typeof preview.summary.movimientos_a_generar === "number" && (
                <div className="text-xs bg-indigo-50 border border-indigo-200 rounded p-2 text-indigo-800">
                  <strong>Impacto en inventario:</strong>{" "}
                  {preview.summary.movimientos_a_generar} movimiento(s) ·
                  +{preview.summary.unidades_entrada ?? 0} entrada(s) ·
                  −{preview.summary.unidades_salida ?? 0} salida(s)
                </div>
              )}
              {preview.summary.faltantes && (
                <FaltantesBox f={preview.summary.faltantes} />
              )}
              {permiteCrearFaltantes && (
                <label className="flex items-center gap-2 text-sm text-slate-700 select-none">
                  <input type="checkbox" checked={crearFaltantes} onChange={(e) => setCrearFaltantes(e.target.checked)} />
                  Crear categorías, proveedores o ubicaciones faltantes durante la importación
                </label>
              )}
              <PreviewTable rows={preview.rows} />
              <div className="flex justify-between gap-2 pt-2">
                <button onClick={() => setStep("upload")} className="px-4 py-2 text-sm border rounded-lg">← Volver</button>
                <button onClick={handleCommit} disabled={busy || preview.summary.errores === preview.summary.total}
                  className="px-4 py-2 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50">
                  {busy ? "Importando..." : "Confirmar e importar"}
                </button>
              </div>
            </div>
          )}

          {step === "done" && commit && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-sm">
                <Stat label="Total" value={commit.summary.total} color="slate" />
                <Stat label="Insertados" value={commit.summary.inserted} color="green" />
                <Stat label="Actualizados" value={commit.summary.updated} color="sky" />
                <Stat label="Omitidos" value={commit.summary.skipped} color="amber" />
                <Stat label="Errores" value={commit.summary.errors} color="red" />
                <Stat label="Warnings" value={commit.summary.warnings} color="amber" />
              </div>
              {typeof commit.summary.movimientos_generados === "number" && (
                <div className="text-xs bg-indigo-50 border border-indigo-200 rounded p-2 text-indigo-800">
                  <strong>Movimientos generados:</strong> {commit.summary.movimientos_generados} ·
                  +{commit.summary.unidades_entrada ?? 0} entrada(s) ·
                  −{commit.summary.unidades_salida ?? 0} salida(s)
                </div>
              )}
              {commit.errors.length > 0 && (
                <ul className="text-xs bg-red-50 border border-red-200 rounded p-2 max-h-40 overflow-y-auto">
                  {commit.errors.map((e, i) => <li key={i}>• {e}</li>)}
                </ul>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg bg-[#0EA5E9] text-white">Cerrar</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: "slate"|"green"|"sky"|"amber"|"red" }) {
  const colors: Record<string, string> = {
    slate: "bg-slate-50 border-slate-200 text-slate-700",
    green: "bg-emerald-50 border-emerald-200 text-emerald-700",
    sky: "bg-sky-50 border-sky-200 text-sky-700",
    amber: "bg-amber-50 border-amber-200 text-amber-700",
    red: "bg-red-50 border-red-200 text-red-700",
  };
  return (
    <div className={`border rounded-lg px-3 py-2 ${colors[color]}`}>
      <p className="text-[11px] uppercase tracking-wide opacity-75">{label}</p>
      <p className="text-xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

function FaltantesBox({ f }: { f: { categorias: string[]; proveedores: string[]; ubicaciones: string[] } }) {
  const total = f.categorias.length + f.proveedores.length + f.ubicaciones.length;
  if (total === 0) return null;
  return (
    <div className="text-xs bg-amber-50 border border-amber-200 rounded p-2 space-y-1">
      <p className="font-semibold text-amber-800">Referencias faltantes:</p>
      {f.categorias.length > 0 && <p>Categorías: {f.categorias.slice(0, 8).join(", ")}{f.categorias.length > 8 ? "…" : ""}</p>}
      {f.proveedores.length > 0 && <p>Proveedores: {f.proveedores.slice(0, 8).join(", ")}{f.proveedores.length > 8 ? "…" : ""}</p>}
      {f.ubicaciones.length > 0 && <p>Ubicaciones: {f.ubicaciones.slice(0, 8).join(", ")}{f.ubicaciones.length > 8 ? "…" : ""}</p>}
    </div>
  );
}

function PreviewTable({ rows }: { rows: import("@/lib/excel/import-types").PreviewRow[] }) {
  const visibles = rows.slice(0, 200);
  return (
    /* "overflow-auto" cubre ambos ejes (X + Y) en lugar de solo Y.
       "min-w-[640px]" fuerza scroll horizontal en mobile para que las columnas
       "Detalle" y "Mensajes" no se aplasten — sin esto el usuario importa a ciegas. */
    <div className="border rounded-lg overflow-auto max-h-[40vh]">
      <table className="w-full min-w-[640px] sm:min-w-0 text-xs">
        <thead className="bg-slate-50 text-slate-600 sticky top-0">
          <tr>
            <th className="text-left px-2 py-1.5">Fila</th>
            <th className="text-left px-2 py-1.5">Acción</th>
            <th className="text-left px-2 py-1.5">Detalle</th>
            <th className="text-left px-2 py-1.5">Mensajes</th>
          </tr>
        </thead>
        <tbody>
          {visibles.map((r) => {
            const badge =
              r.action === "INSERT" ? "bg-emerald-100 text-emerald-700" :
              r.action === "UPDATE" ? "bg-sky-100 text-sky-700" :
              r.action === "SKIP" ? "bg-amber-100 text-amber-700" :
              "bg-red-100 text-red-700";
            const summary = Object.entries(r.data).slice(0, 3).map(([k, v]) => `${k}=${String(v).slice(0, 40)}`).join(" · ");
            return (
              <tr key={r.row_number} className="border-t border-slate-100">
                <td className="px-2 py-1 text-slate-500">{r.row_number}</td>
                <td className="px-2 py-1"><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${badge}`}>{r.action}</span></td>
                <td className="px-2 py-1 text-slate-700 truncate max-w-md">{summary}</td>
                <td className="px-2 py-1 text-xs">
                  {r.errors.map((e, i) => <div key={`e${i}`} className="text-red-700">⚠ {e}</div>)}
                  {r.warnings.map((w, i) => <div key={`w${i}`} className="text-amber-700">• {w}</div>)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > visibles.length && (
        <div className="text-xs text-slate-400 px-2 py-1 border-t">Mostrando primeras {visibles.length} de {rows.length} filas.</div>
      )}
    </div>
  );
}
