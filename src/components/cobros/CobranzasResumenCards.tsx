"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Resumen = { total_pendiente: number; total_vencido: number; cobrado_mes: number; parciales: number };

function fmtGs(n: number) {
  return "Gs. " + Math.round(Number(n) || 0).toLocaleString("es-PY");
}

/**
 * Cards mínimas de cobranza para el dashboard (cuentas por cobrar de ventas a crédito).
 * Autónomo: lee su propio resumen de /api/cobros/cuentas. No altera el resto del dashboard.
 */
export default function CobranzasResumenCards() {
  const [r, setR] = useState<Resumen | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancel = false;
    fetchWithSupabaseSession("/api/cobros/cuentas", { cache: "no-store" })
      .then((res) => res.json())
      .then((j) => {
        if (cancel) return;
        if (j?.success && j.data?.resumen) setR(j.data.resumen as Resumen);
      })
      .catch(() => {})
      .finally(() => { if (!cancel) setLoaded(true); });
    return () => { cancel = true; };
  }, []);

  // Si no hay nada por cobrar, no ocupar espacio.
  if (loaded && (!r || (r.total_pendiente === 0 && r.cobrado_mes === 0))) return null;

  const cards = [
    { l: "Pendiente por cobrar", v: fmtGs(r?.total_pendiente ?? 0), cls: "border-amber-200 bg-amber-50 text-amber-700" },
    { l: "Vencido", v: fmtGs(r?.total_vencido ?? 0), cls: "border-red-200 bg-red-50 text-red-700" },
    { l: "Cobrado este mes", v: fmtGs(r?.cobrado_mes ?? 0), cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
    { l: "Cuentas parciales", v: String(r?.parciales ?? 0), cls: "border-sky-200 bg-sky-50 text-sky-700" },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Cobranzas (cuentas por cobrar)</h3>
        <Link href="/pagos" className="text-xs font-medium text-[#4FAEB2] hover:underline">Ver Pagos →</Link>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.l} className={`rounded-xl border p-4 shadow-sm ${c.cls}`}>
            <div className="text-[11px] font-medium uppercase tracking-wide opacity-80">{c.l}</div>
            <div className="mt-1 text-xl font-bold">{c.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
