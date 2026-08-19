import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type GenerarReciboInput =
  | { origen: "venta_contado"; venta_id: string }
  | { origen: "cobro_cxc"; cobro_cliente_id: string };

/**
 * Genera (o reutiliza si ya existe) un recibo de dinero y abre su documento imprimible.
 * Idempotente: si ya hay recibo para esa venta/cobro, se reimprime el mismo.
 * Devuelve true si se abrió OK, o un mensaje de error.
 */
export async function generarYAbrirRecibo(input: GenerarReciboInput): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetchWithSupabaseSession("/api/recibos-dinero", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = await res.json();
    if (!res.ok || body?.success === false || !body?.data?.recibo?.id) {
      return { ok: false, error: body?.error ?? "No se pudo generar el recibo." };
    }
    const id = String(body.data.recibo.id);
    try {
      window.open(`/api/recibos-dinero/${id}/pdf?auto=1`, "_blank", "noopener");
    } catch { /* el popup pudo bloquearse */ }
    return { ok: true };
  } catch {
    return { ok: false, error: "Error de red al generar el recibo." };
  }
}
