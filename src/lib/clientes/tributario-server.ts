import type { AppSupabaseClient } from "@/lib/supabase/schema";

export type ObligacionCatalogoRow = {
  id: string;
  slug: string;
  nombre: string;
  requiere_detalle_otro: boolean;
};

export type PerfilTributarioPublic = {
  perfil_activo: boolean;
  dv: string | null;
  razon_social_fiscal: string | null;
  /** 1-31, mismo significado en API que en `cliente_perfil_tributario.dia_vencimiento_tributario`. */
  dia_vencimiento_tributario: number | null;
  honorario_mensual: number | null;
  honorario_anual: number | null;
  notas_tributarias: string | null;
  obligacion_otro_detalle: string | null;
  clave_tributaria_configurada: boolean;
  obligaciones: { id: string; slug: string; nombre: string }[];
};

/** Solo para badge en listados: cliente_id → tiene perfil activo. */
export async function fetchPerfilTributarioActivosMap(
  supabase: AppSupabaseClient,
  empresaId: string,
  clienteIds: string[]
): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>();
  if (clienteIds.length === 0) return map;

  const { data, error } = await supabase
    .from("cliente_perfil_tributario")
    .select("cliente_id, perfil_activo")
    .eq("empresa_id", empresaId)
    .in("cliente_id", clienteIds);

  if (error) {
    console.error("[perfil tributario map]", error.message);
    return map;
  }

  for (const row of data ?? []) {
    const r = row as { cliente_id?: string; perfil_activo?: boolean };
    if (typeof r.cliente_id === "string" && r.cliente_id) {
      map.set(r.cliente_id, r.perfil_activo === true);
    }
  }
  return map;
}

export async function fetchObligacionesCatalogo(supabase: AppSupabaseClient): Promise<ObligacionCatalogoRow[]> {
  const { data, error } = await supabase
    .from("obligaciones_tributarias_catalogo")
    .select("id, slug, nombre, requiere_detalle_otro, orden")
    .order("orden", { ascending: true });

  if (error) {
    console.error("[obligaciones catalogo]", error.message);
    return [];
  }
  return (data ?? []).map((row) => {
    const r = row as ObligacionCatalogoRow & { orden?: number };
    return {
      id: r.id,
      slug: r.slug,
      nombre: r.nombre,
      requiere_detalle_otro: Boolean(r.requiere_detalle_otro),
    };
  });
}

export async function fetchPerfilTributarioDetalle(
  supabase: AppSupabaseClient,
  empresaId: string,
  clienteId: string
): Promise<PerfilTributarioPublic | null> {
  const { data: perfil, error } = await supabase
    .from("cliente_perfil_tributario")
    .select(
      "id, perfil_activo, dv, razon_social_fiscal, dia_vencimiento_tributario, honorario_mensual, honorario_anual, notas_tributarias, obligacion_otro_detalle, clave_tributaria_encrypted"
    )
    .eq("empresa_id", empresaId)
    .eq("cliente_id", clienteId)
    .maybeSingle();

  if (error) {
    console.error("[perfil tributario detalle]", error.message);
    return null;
  }
  if (!perfil) return null;

  const p = perfil as {
    id: string;
    perfil_activo: boolean;
    dv: string | null;
    razon_social_fiscal: string | null;
    dia_vencimiento_tributario: number | null;
    honorario_mensual: number | null;
    honorario_anual: number | null;
    notas_tributarias: string | null;
    obligacion_otro_detalle: string | null;
    clave_tributaria_encrypted: string | null;
  };

  const { data: piv, error: errPiv } = await supabase
    .from("cliente_obligaciones_tributarias")
    .select("obligacion_catalogo_id")
    .eq("cliente_perfil_id", p.id);

  if (errPiv) {
    console.error("[perfil obligaciones piv]", errPiv.message);
  }

  const ids = (piv ?? [])
    .map((x) => (x as { obligacion_catalogo_id?: string }).obligacion_catalogo_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  let obligaciones: { id: string; slug: string; nombre: string }[] = [];
  if (ids.length > 0) {
    const { data: cats } = await supabase
      .from("obligaciones_tributarias_catalogo")
      .select("id, slug, nombre")
      .in("id", ids);
    obligaciones = (cats ?? []).map((c) => {
      const r = c as { id: string; slug: string; nombre: string };
      return { id: r.id, slug: r.slug, nombre: r.nombre };
    });
  }

  const dvt = p.dia_vencimiento_tributario;
  const diaOut: number | null =
    dvt == null ? null : (Number.isFinite(Number(dvt)) ? Math.trunc(Number(dvt)) : null);

  return {
    perfil_activo: p.perfil_activo,
    dv: p.dv,
    razon_social_fiscal: p.razon_social_fiscal,
    dia_vencimiento_tributario: diaOut,
    honorario_mensual: p.honorario_mensual,
    honorario_anual: p.honorario_anual,
    notas_tributarias: p.notas_tributarias,
    obligacion_otro_detalle: p.obligacion_otro_detalle,
    clave_tributaria_configurada: Boolean(p.clave_tributaria_encrypted?.trim()),
    obligaciones,
  };
}
