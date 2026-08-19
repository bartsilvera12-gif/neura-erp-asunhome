"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { fetchWithSupabaseSession, isAbortError } from "@/lib/api/fetch-with-supabase-session";

type SorteoListItem = {
  id: string;
  nombre: string;
  estado?: string;
  ticket_delivery_mode?: string;
};

export default function SorteosCuponesManualClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sorteoFromUrl = searchParams?.get("sorteo_id")?.trim() ?? "";

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sorteos, setSorteos] = useState<SorteoListItem[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [form, setForm] = useState({
    sorteo_id: "",
    nombre: "",
    apellido: "",
    cedula: "",
    telefono: "",
    cantidad_boletos: "1",
    monto_total: "",
    observacion_interna: "",
    generar_ticket_png: true,
  });
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [submitOk, setSubmitOk] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setIdempotencyKey(crypto.randomUUID());
    setSubmitErr(null);
    setSubmitOk(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // AbortController: si el modal se cierra mid-fetch, abortamos.
    // Modales se abren y cierran rapido — patron critico para evitar
    // setState-after-unmount y race conditions con multiples aperturas.
    const ctrl = new AbortController();
    (async () => {
      setLoadErr(null);
      try {
        const res = await fetchWithSupabaseSession("/api/sorteos", {
          cache: "no-store",
          signal: ctrl.signal,
        });
        if (ctrl.signal.aborted) return;
        const json = (await res.json()) as { success?: boolean; data?: SorteoListItem[] };
        if (ctrl.signal.aborted) return;
        if (!res.ok || !json.success || !Array.isArray(json.data)) {
          setLoadErr("No se pudieron cargar los sorteos.");
          return;
        }
        const activos = json.data.filter((s) => (s.estado ?? "activo") === "activo");
        setSorteos(activos.length > 0 ? activos : json.data);
      } catch (e) {
        if (isAbortError(e)) return;
        setLoadErr("Error de red al cargar sorteos.");
      }
    })();
    return () => ctrl.abort();
  }, [open]);

  useEffect(() => {
    if (!open || sorteos.length === 0) return;
    setForm((f) => {
      if (f.sorteo_id) return f;
      const pick =
        sorteoFromUrl && sorteos.some((s) => s.id === sorteoFromUrl)
          ? sorteoFromUrl
          : sorteos[0]?.id ?? "";
      return { ...f, sorteo_id: pick };
    });
  }, [open, sorteos, sorteoFromUrl]);

  const onField = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const { name, value, type } = e.target;
      if (type === "checkbox") {
        const c = e.target as HTMLInputElement;
        setForm((p) => ({ ...p, [name]: c.checked }));
        return;
      }
      setForm((p) => ({ ...p, [name]: value }));
    },
    []
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitErr(null);
    setSubmitOk(null);

    const cantidad = Math.floor(Number(form.cantidad_boletos));
    const monto = Number(form.monto_total);
    if (!form.sorteo_id) {
      setSubmitErr("Elegí un sorteo.");
      return;
    }
    if (!form.nombre.trim() || !form.apellido.trim()) {
      setSubmitErr("Nombre y apellido son obligatorios.");
      return;
    }
    if (!form.telefono.trim()) {
      setSubmitErr("El teléfono es obligatorio.");
      return;
    }
    if (!Number.isFinite(cantidad) || cantidad < 1) {
      setSubmitErr("La cantidad de boletos debe ser mayor a 0.");
      return;
    }
    if (!Number.isFinite(monto) || monto < 0) {
      setSubmitErr("El monto total debe ser mayor o igual a 0.");
      return;
    }
    if (!idempotencyKey) {
      setSubmitErr("Falta clave de idempotencia; cerrá y volvé a abrir el formulario.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetchWithSupabaseSession("/api/sorteos/manual-sale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sorteo_id: form.sorteo_id,
          nombre: form.nombre.trim(),
          apellido: form.apellido.trim(),
          cedula: form.cedula.trim(),
          telefono: form.telefono.trim(),
          cantidad_boletos: cantidad,
          monto_total: monto,
          observacion_interna: form.observacion_interna.trim() || null,
          generar_ticket_png: form.generar_ticket_png,
          idempotency_key: idempotencyKey,
        }),
      });
      const json = (await res.json()) as {
        success?: boolean;
        data?: {
          entrada_id?: string;
          numero_orden?: number;
          ticket?: { attempted?: boolean; delivery_ok?: boolean; skipped?: boolean; reason?: string };
        };
        error?: string;
      };
      if (!res.ok || !json.success) {
        setSubmitErr(json.error ?? "No se pudo registrar la venta.");
        return;
      }

      const num = json.data?.numero_orden ?? "—";
      let msg = `Orden Nº ${num} creada correctamente (pago confirmado).`;
      const t = json.data?.ticket;
      if (form.generar_ticket_png && t?.attempted) {
        if (t.delivery_ok && t.skipped && t.reason === "text_only") {
          msg += " Ticket PNG omitido: el sorteo está en modo solo texto.";
        } else if (t.delivery_ok === false) {
          msg += ` Advertencia: no se generó el ticket PNG (${t.reason ?? "error"}). La orden quedó registrada.`;
        } else if (t.skipped) {
          msg += ` Ticket: ${t.reason ?? "omitido"}.`;
        }
      }
      setSubmitOk(msg);
      setForm((p) => ({
        ...p,
        nombre: "",
        apellido: "",
        cedula: "",
        telefono: "",
        cantidad_boletos: "1",
        monto_total: "",
        observacion_interna: "",
      }));
      router.refresh();
    } catch {
      setSubmitErr("Error de red al guardar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="bg-emerald-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-emerald-700 shadow-sm"
      >
        Crear cupón manual
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div
            role="dialog"
            aria-modal="true"
            className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto border border-slate-200"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h2 className="text-lg font-semibold text-slate-800">Venta presencial (efectivo)</h2>
              <button
                type="button"
                className="text-slate-500 hover:text-slate-800 text-xl leading-none px-2"
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
              >
                ×
              </button>
            </div>

            <form onSubmit={onSubmit} className="p-5 space-y-3 text-sm">
              <p className="text-slate-600 text-xs">
                Registra comprador y monto; se confirma el pago al guardar. No se envía WhatsApp ni se crea
                conversación.
              </p>

              {loadErr ? (
                <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900 text-xs">
                  {loadErr}
                </div>
              ) : null}
              {submitErr ? (
                <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-red-800 text-xs">
                  {submitErr}
                </div>
              ) : null}
              {submitOk ? (
                <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900 text-xs">
                  {submitOk}
                </div>
              ) : null}

              <label className="flex flex-col gap-1 text-xs text-slate-600">
                Sorteo *
                <select
                  name="sorteo_id"
                  value={form.sorteo_id}
                  onChange={onField}
                  required
                  className="border border-slate-300 rounded px-2 py-2 text-sm text-slate-900"
                >
                  <option value="">— Elegir —</option>
                  {sorteos.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}
                      {(s.estado ?? "") !== "activo" ? ` (${s.estado})` : ""}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-xs text-slate-600">
                  Nombre *
                  <input
                    name="nombre"
                    value={form.nombre}
                    onChange={onField}
                    required
                    className="border border-slate-300 rounded px-2 py-2 text-sm"
                    autoComplete="given-name"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-slate-600">
                  Apellido *
                  <input
                    name="apellido"
                    value={form.apellido}
                    onChange={onField}
                    required
                    className="border border-slate-300 rounded px-2 py-2 text-sm"
                    autoComplete="family-name"
                  />
                </label>
              </div>

              <label className="flex flex-col gap-1 text-xs text-slate-600">
                Cédula
                <input
                  name="cedula"
                  value={form.cedula}
                  onChange={onField}
                  className="border border-slate-300 rounded px-2 py-2 text-sm font-mono"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs text-slate-600">
                Teléfono *
                <input
                  name="telefono"
                  value={form.telefono}
                  onChange={onField}
                  required
                  placeholder="Ej. 0981123456"
                  className="border border-slate-300 rounded px-2 py-2 text-sm font-mono"
                  autoComplete="tel"
                />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-xs text-slate-600">
                  Cantidad boletos *
                  <input
                    name="cantidad_boletos"
                    type="number"
                    min={1}
                    step={1}
                    value={form.cantidad_boletos}
                    onChange={onField}
                    required
                    className="border border-slate-300 rounded px-2 py-2 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-slate-600">
                  Monto total (₲) *
                  <input
                    name="monto_total"
                    type="number"
                    min={0}
                    step={1}
                    value={form.monto_total}
                    onChange={onField}
                    required
                    className="border border-slate-300 rounded px-2 py-2 text-sm tabular-nums"
                  />
                </label>
              </div>

              <label className="flex flex-col gap-1 text-xs text-slate-600">
                Método de pago
                <input
                  value="Efectivo"
                  readOnly
                  className="border border-slate-200 bg-slate-50 rounded px-2 py-2 text-sm text-slate-700"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs text-slate-600">
                Observación interna (opcional)
                <textarea
                  name="observacion_interna"
                  value={form.observacion_interna}
                  onChange={onField}
                  rows={2}
                  className="border border-slate-300 rounded px-2 py-2 text-sm"
                />
              </label>

              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  name="generar_ticket_png"
                  checked={form.generar_ticket_png}
                  onChange={onField}
                />
                Generar ticket PNG (si el sorteo tiene imagen configurada)
              </label>

              <div className="flex flex-wrap gap-2 pt-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="bg-[#0EA5E9] text-white font-medium px-4 py-2 rounded-lg hover:bg-sky-600 disabled:opacity-60"
                >
                  {loading ? "Guardando…" : "Guardar venta"}
                </button>
                <button
                  type="button"
                  className="text-slate-600 underline px-2 py-2"
                  onClick={() => setOpen(false)}
                >
                  Cerrar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
