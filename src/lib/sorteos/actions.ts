import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { getBrowserSupabaseForEmpresaData } from "@/lib/supabase/browser-data-client";
import type {
  Sorteo,
  SorteoConversacion,
  SorteoCupon,
  SorteoCuponOrdenRow,
  SorteoEntrada,
  SorteoEstado,
  SorteoCouponNumberMode,
} from "@/lib/sorteos/types";

function mapSorteo(r: Record<string, unknown>): Sorteo {
  return {
    id: r.id as string,
    empresa_id: r.empresa_id as string,
    nombre: (r.nombre as string) ?? "",
    descripcion: (r.descripcion as string) ?? null,
    precio_por_boleto: Number(r.precio_por_boleto) ?? 0,
    max_boletos: Number(r.max_boletos) ?? 0,
    total_boletos_vendidos: Number(r.total_boletos_vendidos) ?? 0,
    ultimo_numero_cupon: Number(r.ultimo_numero_cupon) ?? 0,
    fecha_sorteo: (r.fecha_sorteo as string) ?? null,
    estado: (r.estado as SorteoEstado) ?? "activo",
    datos_bancarios: (typeof r.datos_bancarios === "object" && r.datos_bancarios !== null
      ? (r.datos_bancarios as Record<string, unknown>)
      : {}) as Record<string, unknown>,
    imagen_url: (r.imagen_url as string) ?? null,
    ticket_delivery_mode: (r.ticket_delivery_mode as Sorteo["ticket_delivery_mode"]) ?? "text_only",
    ticket_image_config:
      typeof r.ticket_image_config === "object" && r.ticket_image_config !== null
        ? (r.ticket_image_config as Record<string, unknown>)
        : {},
    created_at: (r.created_at as string) ?? "",
    updated_at: (r.updated_at as string) ?? "",
    coupon_numbering_enabled: Boolean(r.coupon_numbering_enabled),
    coupon_number_start:
      r.coupon_number_start != null && Number.isFinite(Number(r.coupon_number_start))
        ? Math.trunc(Number(r.coupon_number_start))
        : null,
    coupon_number_mode: (r.coupon_number_mode as SorteoCouponNumberMode | null) ?? null,
    coupon_number_limit:
      r.coupon_number_limit != null && Number.isFinite(Number(r.coupon_number_limit))
        ? Math.trunc(Number(r.coupon_number_limit))
        : null,
  };
}

export async function getSorteos(): Promise<Sorteo[]> {
  const res = await fetchWithSupabaseSession("/api/sorteos", { cache: "no-store" });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(t || `${res.status}`);
  }
  const json = (await res.json()) as { success?: boolean; data?: unknown[] };
  if (!json.success || !Array.isArray(json.data)) return [];
  return json.data.map((r) => mapSorteo(r as Record<string, unknown>));
}

export async function getSorteoById(id: string): Promise<Sorteo | null> {
  const res = await fetchWithSupabaseSession(`/api/sorteos/${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(t || `${res.status}`);
  }
  const json = (await res.json()) as { success?: boolean; data?: Record<string, unknown> };
  if (!json.success || !json.data) return null;
  return mapSorteo(json.data);
}

export type SorteoInput = {
  nombre: string;
  descripcion?: string;
  precio_por_boleto: number;
  max_boletos: number;
  fecha_sorteo?: string | null;
  estado: SorteoEstado;
  datos_bancarios: Record<string, unknown>;
  imagen_url?: string | null;
  ticket_delivery_mode?: Sorteo["ticket_delivery_mode"];
  ticket_image_config?: Record<string, unknown>;
  coupon_numbering_enabled?: boolean;
  coupon_number_start?: number | null;
  coupon_number_mode?: SorteoCouponNumberMode | null;
  coupon_number_limit?: number | null;
};

export async function createSorteo(input: SorteoInput): Promise<Sorteo> {
  const res = await fetchWithSupabaseSession("/api/sorteos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nombre: input.nombre.trim(),
      descripcion: input.descripcion?.trim() || null,
      precio_por_boleto: input.precio_por_boleto,
      max_boletos: input.max_boletos,
      fecha_sorteo: input.fecha_sorteo || null,
      estado: input.estado,
      datos_bancarios: input.datos_bancarios,
      imagen_url: input.imagen_url?.trim() || null,
      ticket_delivery_mode: input.ticket_delivery_mode ?? "text_only",
      ticket_image_config: input.ticket_image_config ?? {},
      coupon_numbering_enabled: input.coupon_numbering_enabled ?? false,
      coupon_number_start: input.coupon_number_start ?? null,
      coupon_number_mode: input.coupon_number_mode ?? null,
      coupon_number_limit: input.coupon_number_limit ?? null,
    }),
  });
  const json = (await res.json()) as { success?: boolean; data?: Record<string, unknown>; error?: string };
  if (!res.ok) {
    throw new Error(json.error || `${res.status}`);
  }
  if (!json.success || !json.data) throw new Error("Respuesta inválida");
  return mapSorteo(json.data);
}

export async function updateSorteo(id: string, input: SorteoInput): Promise<Sorteo> {
  const res = await fetchWithSupabaseSession(`/api/sorteos/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nombre: input.nombre.trim(),
      descripcion: input.descripcion?.trim() || null,
      precio_por_boleto: input.precio_por_boleto,
      max_boletos: input.max_boletos,
      fecha_sorteo: input.fecha_sorteo || null,
      estado: input.estado,
      datos_bancarios: input.datos_bancarios,
      imagen_url: input.imagen_url?.trim() || null,
      ticket_delivery_mode: input.ticket_delivery_mode ?? "text_only",
      ticket_image_config: input.ticket_image_config ?? {},
      coupon_numbering_enabled: input.coupon_numbering_enabled ?? false,
      coupon_number_start: input.coupon_number_start ?? null,
      coupon_number_mode: input.coupon_number_mode ?? null,
      coupon_number_limit: input.coupon_number_limit ?? null,
    }),
  });
  const json = (await res.json()) as { success?: boolean; data?: Record<string, unknown>; error?: string };
  if (!res.ok) {
    throw new Error(json.error || `${res.status}`);
  }
  if (!json.success || !json.data) throw new Error("No se pudo actualizar el sorteo.");
  return mapSorteo(json.data);
}

export async function getSorteoConversaciones(): Promise<SorteoConversacion[]> {
  const supabase = await getBrowserSupabaseForEmpresaData();
  const { data, error } = await supabase
    .from("sorteo_conversaciones")
    .select("*, sorteos(nombre)")
    .order("updated_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as SorteoConversacion[];
}

export async function getSorteoEntradas(): Promise<SorteoEntrada[]> {
  const supabase = await getBrowserSupabaseForEmpresaData();
  const { data, error } = await supabase
    .from("sorteo_entradas")
    .select("*, sorteos(nombre)")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as SorteoEntrada[];
}

export async function getSorteoCupones(): Promise<SorteoCupon[]> {
  const supabase = await getBrowserSupabaseForEmpresaData();
  const { data, error } = await supabase
    .from("sorteo_cupones")
    .select("*, sorteos(nombre), sorteo_entradas(nombre_participante)")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as SorteoCupon[];
}

/** Una fila por orden con los números de cupón agregados (vista operativa Cupones). */
export async function getSorteoCuponesOrdenes(): Promise<SorteoCuponOrdenRow[]> {
  const supabase = await getBrowserSupabaseForEmpresaData();
  const { data, error } = await supabase
    .from("sorteo_entradas")
    .select("*, sorteos(nombre), sorteo_cupones(numero_cupon)")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as Array<{
    id: string;
    numero_orden: number | null;
    nombre_participante: string;
    documento?: string | null;
    whatsapp_numero: string;
    cantidad_boletos: number;
    monto_total: number | null;
    promo_nombre?: string | null;
    precio_fuente?: string | null;
    estado_pago: string;
    created_at: string;
    chat_conversation_id: string | null;
    sorteos?: { nombre: string } | null;
    sorteo_cupones?: { numero_cupon: string }[] | null;
  }>;

  return rows
    .map((r) => {
      const cupones = Array.isArray(r.sorteo_cupones) ? r.sorteo_cupones : [];
      const numeros = cupones.map((c) => c.numero_cupon).filter(Boolean).sort();
      if (numeros.length === 0) return null;
      const sorteoJoin = r.sorteos;
      const sorteoNombre =
        sorteoJoin && !Array.isArray(sorteoJoin)
          ? sorteoJoin.nombre
          : Array.isArray(sorteoJoin) && sorteoJoin[0]
            ? sorteoJoin[0].nombre
            : "—";
      const mt =
        typeof r.monto_total === "number" && Number.isFinite(r.monto_total)
          ? r.monto_total
          : Number(r.monto_total);
      const montoTotal = Number.isFinite(mt) ? mt : 0;
      const pfRaw = r.precio_fuente;
      const pf =
        pfRaw === "promo" || pfRaw === "lista" ? pfRaw : null;
      const promoNom = r.promo_nombre;
      return {
        entrada_id: r.id,
        sorteo_id: String((r as { sorteo_id?: string }).sorteo_id ?? ""),
        numero_orden: typeof r.numero_orden === "number" ? r.numero_orden : 0,
        nombre_participante: r.nombre_participante,
        documento: r.documento?.trim() ? r.documento.trim() : null,
        whatsapp_numero: r.whatsapp_numero,
        cantidad_boletos: r.cantidad_boletos,
        monto_total: montoTotal,
        promo_nombre:
          typeof promoNom === "string" && promoNom.trim() ? promoNom.trim() : null,
        precio_fuente: pf,
        estado_pago: r.estado_pago as SorteoCuponOrdenRow["estado_pago"],
        created_at: r.created_at,
        chat_conversation_id: r.chat_conversation_id ?? null,
        sorteo_nombre: sorteoNombre ?? "—",
        numeros_cupon: numeros,
        cupones_impresos_at:
          (r as { cupones_impresos_at?: string | null }).cupones_impresos_at != null
            ? String((r as { cupones_impresos_at?: string | null }).cupones_impresos_at)
            : null,
      };
    })
    .filter((x): x is SorteoCuponOrdenRow => x !== null);
}
