"use client";

import { useEffect, useMemo, useState } from "react";
import { filasTiposDesdeSistemaEstatico, fetchTiposFormCliente } from "./fetch-tipos-servicio-form";
import type { ClienteTipoServicioRow } from "./tipo-servicio-catalogo";

type ConTipoSlug = { tipo_servicio_cliente?: string | null };

/**
 * Mapa `slug` → `nombre` desde `cliente_tipos_servicio_catalogo` (misma lógica que
 * `GET /api/cliente-tipos-servicio?form=1` + `include_slug` por faltante).
 * Sirve evitar N+1: una carga base y solo peticiones adicionales por slugs huérfanos.
 */
export function useMapNombreTipoServicioCatalogo(entradas: readonly ConTipoSlug[] | null | undefined) {
  const [filas, setFilas] = useState<ClienteTipoServicioRow[]>(filasTiposDesdeSistemaEstatico);
  const list = entradas ?? [];
  const slugsKey = useMemo(() => {
    const s = new Set<string>();
    for (const c of list) {
      const t = (c.tipo_servicio_cliente ?? "").trim().toLowerCase();
      if (t) s.add(t);
    }
    return [...s].sort().join(",");
  }, [list]);

  useEffect(() => {
    let cancel = false;
    const need = slugsKey ? slugsKey.split(",") : [];
    (async () => {
      const bySlug = new Map<string, ClienteTipoServicioRow>();
      const base = await fetchTiposFormCliente();
      if (cancel) return;
      for (const r of base) bySlug.set(r.slug, r);
      for (const slug of need) {
        if (bySlug.has(slug)) continue;
        const withInc = await fetchTiposFormCliente(slug);
        if (cancel) return;
        for (const r of withInc) {
          if (!bySlug.has(r.slug)) bySlug.set(r.slug, r);
        }
      }
      setFilas([...bySlug.values()].sort((a, b) => a.orden - b.orden));
    })();
    return () => {
      cancel = true;
    };
  }, [slugsKey]);

  return useMemo(() => {
    const m: Record<string, string> = {};
    for (const t of filas) m[t.slug] = t.nombre;
    return m;
  }, [filas]);
}
