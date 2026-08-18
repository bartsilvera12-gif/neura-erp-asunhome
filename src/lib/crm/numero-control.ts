import type { AppSupabaseClient } from "@/lib/supabase/schema";

/** Siguiente numeración CRM-###### a partir del último valor conocido. */
export function nextNumeroControlFromLast(last: string | null | undefined): string {
  const m = (last ?? "").match(/CRM-(\d+)/i);
  const next = (parseInt(m?.[1] ?? "0", 10) || 0) + 1;
  return `CRM-${String(next).padStart(6, "0")}`;
}

/**
 * Reutiliza la misma lógica de numeración que el CRM:
 *  - busca el último numero_control
 *  - parsea CRM-XXXX
 *  - incrementa y vuelve a formatear CRM-000001
 */
export async function generarNumeroControlFromSupabase(
  sb: AppSupabaseClient,
  empresaId?: string
): Promise<string> {
  let q = sb
    .from("crm_prospectos")
    .select("numero_control")
    .order("created_at", { ascending: false })
    .limit(1);
  if (empresaId?.trim()) {
    q = q.eq("empresa_id", empresaId.trim());
  }
  const { data } = await q;

  const last = data?.[0] as { numero_control?: string } | undefined;
  return nextNumeroControlFromLast(last?.numero_control);
}

