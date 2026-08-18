"use client";

import { useEffect, useState } from "react";
import MontoInput, { parseMontoInput } from "@/components/ui/MontoInput";
import { apiCreatePago } from "@/lib/api/client";
import { hoyYmdLocal } from "@/lib/fechas/calendario";

const inputClass =
  "w-full border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#0EA5E9] focus:outline-none bg-white text-sm";
const labelClass = "block text-xs font-medium text-slate-500 mb-1";

export type RegistrarPagoFacturaRef = {
  id: string;
  numero_factura: string;
  saldo: number;
  moneda: "GS" | "USD";
};

type MetodoPago = "efectivo" | "transferencia" | "cheque" | "tarjeta" | "otro";

function saldoDescripcion(f: RegistrarPagoFacturaRef) {
  if (f.moneda === "USD") {
    return `Factura ${f.numero_factura} — Saldo: USD ${f.saldo.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })}`;
  }
  return `Factura ${f.numero_factura} — Saldo: Gs. ${f.saldo.toLocaleString("es-PY")}`;
}

export function RegistrarPagoModal({
  open,
  factura,
  onClose,
  onExito,
}: {
  open: boolean;
  factura: RegistrarPagoFacturaRef | null;
  onClose: () => void;
  onExito: () => void | Promise<void>;
}) {
  const [monto, setMonto] = useState("");
  const [fechaPago, setFechaPago] = useState("");
  const [metodoPago, setMetodoPago] = useState<MetodoPago>("efectivo");
  const [referencia, setReferencia] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!open || !factura) return;
    setMonto(String(factura.saldo));
    setFechaPago(hoyYmdLocal());
    setMetodoPago("efectivo");
    setReferencia("");
  }, [open, factura?.id, factura?.saldo, factura?.moneda, factura?.numero_factura]);

  if (!open || !factura) return null;

  const f = factura;
  const decimals = f.moneda === "USD";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const m = parseMontoInput(String(monto));
    if (m > f.saldo) {
      window.alert("El monto del pago no puede superar el saldo pendiente de la factura.");
      return;
    }
    if (m <= 0) {
      window.alert("Ingresá un monto mayor a cero.");
      return;
    }
    setGuardando(true);
    const result = await apiCreatePago({
      factura_id: f.id,
      monto: m,
      fecha_pago: fechaPago,
      metodo_pago: metodoPago,
      referencia: referencia.trim() || undefined,
    });
    setGuardando(false);
    if (result) {
      await Promise.resolve(onExito());
      onClose();
    } else {
      window.alert("Error al registrar el pago. Verificá el monto y vuelve a intentar.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="registrar-pago-titulo"
      >
        <h3 id="registrar-pago-titulo" className="mb-4 text-lg font-bold text-gray-800">
          Registrar pago
        </h3>
        <p className="mb-4 text-sm text-slate-600">{saldoDescripcion(f)}</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={labelClass} htmlFor="reg-pago-monto">
              Monto
            </label>
            <MontoInput
              id="reg-pago-monto"
              value={monto}
              onChange={(n) => setMonto(String(n))}
              className={inputClass}
              decimals={decimals}
              required
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="reg-pago-fecha">
              Fecha pago
            </label>
            <input
              id="reg-pago-fecha"
              type="date"
              value={fechaPago}
              onChange={(e) => setFechaPago(e.target.value)}
              className={inputClass}
              required
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="reg-pago-metodo">
              Método de pago
            </label>
            <select
              id="reg-pago-metodo"
              value={metodoPago}
              onChange={(e) => setMetodoPago(e.target.value as MetodoPago)}
              className={inputClass}
            >
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="cheque">Cheque</option>
              <option value="tarjeta">Tarjeta</option>
              <option value="otro">Otro</option>
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="reg-pago-ref">
              Referencia
            </label>
            <input
              id="reg-pago-ref"
              type="text"
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
              className={inputClass}
              placeholder="Nº de comprobante"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={guardando}
              className="rounded-lg bg-[#0EA5E9] px-4 py-2 text-sm font-medium text-white hover:bg-[#0284C7] disabled:opacity-50"
            >
              Guardar
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm hover:bg-slate-50"
            >
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
