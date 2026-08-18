import { useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

/** Respuesta alineada a POST /api/facturas/sifen/estados */
export type FacturaSifenEstadoItem = {
  factura_electronica_id: string | null;
  estado_sifen: string | null;
};

export type FacturaSifenEstadoMap = Record<string, FacturaSifenEstadoItem>;

/**
 * Carga en lote el estado SIFEN para un conjunto de facturas (una sola petición).
 * `estado_sifen === null` → sin registro en factura_electronica (UI: "Sin SIFEN").
 */
export function useFacturaSifenEstados(facturaIds: readonly string[]): FacturaSifenEstadoMap {
  const sortedKey = [...new Set(facturaIds.filter(Boolean))].sort().join("|");
  const [map, setMap] = useState<FacturaSifenEstadoMap>({});

  useEffect(() => {
    if (!sortedKey) {
      setMap({});
      return;
    }
    const ids = sortedKey.split("|");
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithSupabaseSession("/api/facturas/sifen/estados", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ factura_ids: ids }),
        });
        const j = (await res.json()) as {
          success?: boolean;
          data?: { by_factura_id?: FacturaSifenEstadoMap };
        };
        if (cancelled || !j.success) return;
        setMap(j.data?.by_factura_id ?? {});
      } catch {
        if (!cancelled) setMap({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sortedKey]);

  return map;
}
