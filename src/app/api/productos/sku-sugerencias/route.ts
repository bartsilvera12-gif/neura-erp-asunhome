import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * GET /api/productos/sku-sugerencias?tipo=<reventa|menu|materia>
 *
 * Devuelve:
 *  - sugerido: SKU autogenerado para el tipo (REV/MEN/MP) con el próximo número.
 *  - patrones: prefijos detectados en SKUs existentes + los por tipo, cada uno
 *    con su "siguiente" (próximo número), para el dropdown "Usar patrón existente".
 * Solo lectura sobre productos.sku. No toca ventas/compras.
 */

const PREFIJO_TIPO: Record<string, string> = { reventa: "REV", menu: "MEN", materia: "MP" };

function pad(n: number, width: number): string {
  return String(n).padStart(Math.max(width, 1), "0");
}

/** Separa "QA-MAY-001" → {prefix:"QA-MAY", num:1, width:3}. Si no hay número final, null. */
function parseSku(sku: string): { prefix: string; num: number; width: number } | null {
  const m = /^(.+?)[-_](\d+)$/.exec(sku.trim());
  if (!m) return null;
  return { prefix: m[1], num: parseInt(m[2], 10) || 0, width: m[2].length };
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const tipo = (new URL(request.url).searchParams.get("tipo") ?? "reventa").toLowerCase();
    const prefijoTipo = PREFIJO_TIPO[tipo] ?? "REV";

    // Paginado: Supabase corta a 1000 filas por default. Si el tenant tiene mas
    // productos, se pierden los SKUs mas altos y la sugerencia queda desactualizada
    // (bug: sugiere un numero ya tomado).
    const PAGE = 1000;
    const skus: string[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await ctx.supabase
        .from("productos")
        .select("sku")
        .eq("empresa_id", ctx.auth.empresa_id)
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const chunk = (data ?? []) as Array<{ sku: string | null }>;
      for (const r of chunk) if (r.sku) skus.push(r.sku);
      if (chunk.length < PAGE) break;
    }

    // prefix -> { maxNum, width }
    const map = new Map<string, { maxNum: number; width: number }>();
    for (const sku of skus) {
      const p = parseSku(sku);
      if (!p) continue;
      const cur = map.get(p.prefix);
      if (!cur) map.set(p.prefix, { maxNum: p.num, width: p.width });
      else map.set(p.prefix, { maxNum: Math.max(cur.maxNum, p.num), width: Math.max(cur.width, p.width) });
    }

    // Asegurar que los 3 prefijos por tipo existan en la lista (aunque no se hayan usado).
    for (const px of Object.values(PREFIJO_TIPO)) {
      if (!map.has(px)) map.set(px, { maxNum: 0, width: 4 });
    }

    const patrones = [...map.entries()]
      .map(([prefix, v]) => ({
        prefix,
        siguiente: `${prefix}-${pad(v.maxNum + 1, Math.max(v.width, 4))}`,
      }))
      .sort((a, b) => a.prefix.localeCompare(b.prefix));

    const def = map.get(prefijoTipo) ?? { maxNum: 0, width: 4 };
    const sugerido = `${prefijoTipo}-${pad(def.maxNum + 1, Math.max(def.width, 4))}`;

    return NextResponse.json(successResponse({ sugerido, prefijo_tipo: prefijoTipo, patrones }));
  } catch (err) {
    console.error("[/api/productos/sku-sugerencias]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron generar sugerencias de SKU."), { status: 500 });
  }
}
