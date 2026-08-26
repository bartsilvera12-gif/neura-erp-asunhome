import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { membreteA4 } from "@/lib/documentos/membrete";

/**
 * GET /api/presupuestos/[id]/pdf?auto=1
 *
 * Documento comercial A4 imprimible (HTML). El navegador imprime / guarda como PDF.
 * NO fiscal, NO toca SIFEN, NO descuenta stock.
 */

const NEGOCIO_FALLBACK = "ASUNHOME";

function resolveNegocio(nombreEmpresa?: string | null): string {
  const env = (process.env.NEURA_CLIENT_NAME ?? "").trim();
  if (env) return env;
  const e = (nombreEmpresa ?? "").trim();
  if (e) return e;
  return NEGOCIO_FALLBACK;
}

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtMoneda(n: unknown, moneda: string): string {
  const v = Number(n) || 0;
  const simbolo = moneda === "USD" ? "USD " : "Gs. ";
  return simbolo + v.toLocaleString("es-PY", { maximumFractionDigits: moneda === "USD" ? 2 : 0 });
}

function fmtFecha(iso: unknown): string {
  if (!iso) return "—";
  try {
    return new Date(String(iso)).toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch {
    return String(iso);
  }
}

const IVA_LABEL: Record<string, string> = { EXENTA: "Exenta", "5%": "5%", "10%": "10%" };

export async function GET(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  const { id } = await ctxParams.params;
  const auto = new URL(request.url).searchParams.get("auto") === "1";

  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) {
    return new NextResponse("No autorizado", { status: 401 });
  }

  const pq = await ctx.supabase
    .from("presupuestos")
    .select("*")
    .eq("empresa_id", ctx.auth.empresa_id)
    .eq("id", id)
    .maybeSingle();
  if (pq.error || !pq.data) {
    return new NextResponse("Presupuesto no encontrado", { status: 404 });
  }
  const p = pq.data as Record<string, unknown>;

  const itq = await ctx.supabase
    .from("presupuesto_items")
    .select("producto_nombre, sku, cantidad, unidad_medida, precio_unitario, iva_tipo, descuento, total")
    .eq("empresa_id", ctx.auth.empresa_id)
    .eq("presupuesto_id", id)
    .order("created_at", { ascending: true });
  const items = (itq.data ?? []) as Record<string, unknown>[];

  // Nombre del negocio.
  let nombreEmpresa: string | null = null;
  try {
    const eq = await ctx.supabase
      .from("empresas")
      .select("nombre_empresa")
      .eq("id", ctx.auth.empresa_id)
      .maybeSingle();
    nombreEmpresa = (eq.data as { nombre_empresa?: string } | null)?.nombre_empresa ?? null;
  } catch {
    /* fallback al nombre por defecto */
  }
  const negocio = resolveNegocio(nombreEmpresa);
  const moneda = String(p.moneda ?? "PYG");

  const filas = items
    .map((it) => {
      const cant = Number(it.cantidad) || 0;
      const unidad = it.unidad_medida ? ` ${esc(it.unidad_medida)}` : "";
      return `
      <tr>
        <td class="c">${cant.toLocaleString("es-PY", { maximumFractionDigits: 3 })}${unidad}</td>
        <td>${esc(it.producto_nombre)}${it.sku ? `<span class="sku"> · ${esc(it.sku)}</span>` : ""}</td>
        <td class="r">${fmtMoneda(it.precio_unitario, moneda)}</td>
        <td class="c">${esc(IVA_LABEL[String(it.iva_tipo)] ?? it.iva_tipo)}</td>
        <td class="r">${Number(it.descuento) > 0 ? fmtMoneda(it.descuento, moneda) : "—"}</td>
        <td class="r">${fmtMoneda(it.total, moneda)}</td>
      </tr>`;
    })
    .join("");

  const condiciones: string[] = [];
  if (p.validez_dias) condiciones.push(`Validez: ${esc(p.validez_dias)} día(s)${p.fecha_vencimiento ? ` (vence ${fmtFecha(p.fecha_vencimiento)})` : ""}`);
  if (p.forma_pago) condiciones.push(`Forma de pago: ${esc(p.forma_pago)}`);
  if (p.plazo_entrega) condiciones.push(`Plazo de entrega: ${esc(p.plazo_entrega)}`);

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.numero_control)} — Presupuesto</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #1f2937; background: #f3f4f6; }
  .page { width: 210mm; min-height: 297mm; margin: 0 auto; background: #fff; padding: 18mm 16mm; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #4FAEB2; padding-bottom: 12px; }
  .negocio { font-size: 22px; font-weight: 800; color: #1f2937; }
  .doc-tag { color: #6b7280; font-size: 12px; margin-top: 2px; letter-spacing: .08em; text-transform: uppercase; }
  .meta { text-align: right; font-size: 13px; }
  .meta .num { font-size: 18px; font-weight: 700; color: #4FAEB2; }
  .grid2 { display: flex; gap: 24px; margin-top: 16px; }
  .box { flex: 1; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 14px; }
  .box h3 { margin: 0 0 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #6b7280; }
  .box p { margin: 2px 0; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; margin-top: 18px; font-size: 13px; }
  thead th { background: #4FAEB2; color: #fff; text-align: left; padding: 8px 10px; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  thead th.c, thead th.r { text-align: center; }
  thead th.r { text-align: right; }
  tbody td { padding: 8px 10px; border-bottom: 1px solid #eef2f4; vertical-align: top; }
  tbody td.c { text-align: center; }
  tbody td.r { text-align: right; }
  .sku { color: #9ca3af; font-size: 11px; }
  .totales { margin-top: 14px; margin-left: auto; width: 56%; font-size: 14px; }
  .totales tr td { padding: 5px 10px; border: none; }
  .totales tr td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
  .totales .total-row td { border-top: 2px solid #4FAEB2; font-weight: 800; font-size: 16px; color: #1f2937; }
  .cond { margin-top: 20px; }
  .cond h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #6b7280; margin: 0 0 6px; }
  .cond ul { margin: 0; padding-left: 18px; font-size: 13px; }
  .obs { margin-top: 14px; font-size: 13px; white-space: pre-wrap; }
  .legal { margin-top: 26px; padding-top: 12px; border-top: 1px dashed #d1d5db; font-size: 11px; color: #6b7280; text-align: center; }
  .toolbar { position: sticky; top: 0; background: #111827; color: #fff; padding: 10px 16px; display: flex; gap: 10px; justify-content: center; }
  .toolbar button { background: #4FAEB2; color: #fff; border: 0; padding: 8px 16px; border-radius: 6px; font-size: 14px; cursor: pointer; }
  .corte { display: none; }
  @media print {
    body { background: #fff; }
    .toolbar { display: none; }
    .page { width: auto; min-height: auto; margin: 0; padding: 14mm 14mm 10mm; }
    /* margin: 0 quita el encabezado/pie del navegador (fecha, título y URL). */
    @page { size: A4 portrait; margin: 0; }
    .corte { display: flex; align-items: center; gap: 8px; margin-top: 14px; padding-top: 6px;
             font-size: 10px; color: #888; border-top: 1px dashed #999; }
    .corte span { flex: 1; text-align: center; letter-spacing: 1px; text-transform: uppercase; }
  }
</style>
</head>
<body>
  <div class="toolbar"><button onclick="window.print()">Imprimir / Guardar PDF</button></div>
  <div class="page">
    ${membreteA4()}
    <div class="head">
      <div>
        <div class="negocio">PRESUPUESTO</div>
        <div class="doc-tag">${esc(negocio)}</div>
      </div>
      <div class="meta">
        <div class="num">${esc(p.numero_control)}</div>
        <div>Fecha: ${fmtFecha(p.fecha)}</div>
        ${p.fecha_vencimiento ? `<div>Válido hasta: ${fmtFecha(p.fecha_vencimiento)}</div>` : ""}
      </div>
    </div>

    <div class="grid2">
      <div class="box">
        <h3>Cliente</h3>
        <p><strong>${esc(p.cliente_nombre)}</strong></p>
        ${p.cliente_ruc ? `<p>RUC/CI: ${esc(p.cliente_ruc)}</p>` : ""}
        ${p.cliente_telefono ? `<p>Tel: ${esc(p.cliente_telefono)}</p>` : ""}
        ${p.cliente_direccion ? `<p>${esc(p.cliente_direccion)}</p>` : ""}
      </div>
      <div class="box">
        <h3>Datos del presupuesto</h3>
        <p>Moneda: ${moneda === "USD" ? "Dólares (USD)" : "Guaraníes (PYG)"}</p>
        ${p.validez_dias ? `<p>Validez: ${esc(p.validez_dias)} día(s)</p>` : ""}
        ${p.forma_pago ? `<p>Forma de pago: ${esc(p.forma_pago)}</p>` : ""}
        ${p.plazo_entrega ? `<p>Plazo de entrega: ${esc(p.plazo_entrega)}</p>` : ""}
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th class="c">Cant.</th>
          <th>Descripción</th>
          <th class="r">Precio unit.</th>
          <th class="c">IVA</th>
          <th class="r">Desc.</th>
          <th class="r">Total</th>
        </tr>
      </thead>
      <tbody>
        ${filas || `<tr><td colspan="6" class="c">Sin ítems</td></tr>`}
      </tbody>
    </table>

    <table class="totales">
      <tr><td>Subtotal (sin IVA)</td><td>${fmtMoneda(p.subtotal, moneda)}</td></tr>
      <tr><td>IVA</td><td>${fmtMoneda(p.monto_iva, moneda)}</td></tr>
      ${Number(p.descuento_total) > 0 ? `<tr><td>Descuentos</td><td>- ${fmtMoneda(p.descuento_total, moneda)}</td></tr>` : ""}
      ${Number(p.retencion_iva_monto) > 0 ? `<tr><td>Retención IVA${Number(p.retencion_iva_pct) ? ` (${Number(p.retencion_iva_pct)}%)` : ""}</td><td>- ${fmtMoneda(p.retencion_iva_monto, moneda)}</td></tr>` : ""}
      <tr class="total-row"><td>${Number(p.retencion_iva_monto) > 0 ? "TOTAL A COBRAR" : "TOTAL"}</td><td>${fmtMoneda(p.total, moneda)}</td></tr>
    </table>

    ${condiciones.length ? `<div class="cond"><h3>Condiciones comerciales</h3><ul>${condiciones.map((c) => `<li>${c}</li>`).join("")}</ul></div>` : ""}
    ${p.observaciones ? `<div class="obs"><strong>Observaciones:</strong>\n${esc(p.observaciones)}</div>` : ""}

    <div class="legal">
      Presupuesto sujeto a disponibilidad de stock y validez indicada.<br>
      Documento no fiscal — no válido como factura.
    </div>
    <div class="corte"><span>✂ CORTAR AQUÍ ✂</span></div>
  </div>
  <script>try{ if (${auto ? "true" : "false"}) window.print(); }catch(e){}</script>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
