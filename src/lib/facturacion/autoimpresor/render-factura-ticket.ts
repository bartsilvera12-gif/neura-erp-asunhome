/**
 * Render de la factura autoimpresor en formato TICKET (58/80 mm), con el mismo
 * aspecto que el ticket interno del ERP pero incluyendo los datos fiscales:
 * razón social + RUC del emisor, timbrado + vigencia, número correlativo
 * (EST-PEXP-0000001), condición, cliente y liquidación de IVA (5/10/exentas).
 *
 * Dos modos:
 *  - Emitida (real): número fiscal correlativo, sin marca de agua.
 *  - Borrador: numeración de ejemplo + aviso "SIN VALIDEZ FISCAL" (no consume
 *    la secuencia). Sirve para previsualizar antes de activar el autoimpresor.
 */
import type { LiquidacionIva } from "./emitir-factura";
import { membreteTicket } from "@/lib/documentos/membrete";

export interface FacturaTicketData {
  borrador: boolean;
  motivoBorrador?: string | null;
  widthMm: 58 | 80;
  emisor: {
    razon_social: string;
    ruc: string;
    direccion: string;
    telefono: string;
    logoUrl: string;
  };
  origin: string;
  timbrado: {
    numero: string;
    inicio: string | null;
    fin: string | null;
  };
  numeroCompleto: string;
  fechaEmision: string;
  condicion: "contado" | "credito";
  cliente: { nombre: string; ruc: string | null } | null;
  ventaNumeroControl: string;
  items: Array<{
    cantidad: number;
    descripcion: string;
    precioUnitario: number;
    totalLinea: number;
    tipo_iva: string;
  }>;
  liq: LiquidacionIva;
  autoPrint: boolean;
}

function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function gs(v: number): string {
  return `Gs. ${Math.round(v || 0).toLocaleString("es-PY")}`;
}

function fechaHora(iso: string): string {
  try {
    const d = new Date(iso);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${dd}/${mm}/${d.getFullYear()} ${hh}:${min}`;
  } catch {
    return iso;
  }
}

function fechaCorta(iso: string | null): string {
  if (!iso) return "—";
  const s = String(iso).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

function ivaTag(t: string): string {
  const u = String(t).toUpperCase();
  if (u === "10%") return "(10%)";
  if (u === "5%") return "(5%)";
  return "(E)";
}

// ── Número a letras (guaraníes, enteros) ────────────────────────────────────

const UNIDADES = ["", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve"];
const ESPECIALES: Record<number, string> = {
  10: "diez", 11: "once", 12: "doce", 13: "trece", 14: "catorce", 15: "quince",
  16: "dieciséis", 17: "diecisiete", 18: "dieciocho", 19: "diecinueve",
  20: "veinte", 21: "veintiuno", 22: "veintidós", 23: "veintitrés", 24: "veinticuatro",
  25: "veinticinco", 26: "veintiséis", 27: "veintisiete", 28: "veintiocho", 29: "veintinueve",
};
const DECENAS = ["", "", "veinte", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const CENTENAS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];

function menorMil(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "cien";
  let out = "";
  const c = Math.floor(n / 100);
  const resto = n % 100;
  if (c > 0) out += CENTENAS[c] + (resto > 0 ? " " : "");
  if (resto > 0) {
    if (resto < 10) out += UNIDADES[resto];
    else if (resto <= 29) out += ESPECIALES[resto];
    else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      out += DECENAS[d] + (u > 0 ? " y " + UNIDADES[u] : "");
    }
  }
  return out;
}

function numeroALetras(n: number): string {
  const entero = Math.round(Math.abs(n));
  if (entero === 0) return "cero";
  const millones = Math.floor(entero / 1_000_000);
  const miles = Math.floor((entero % 1_000_000) / 1000);
  const resto = entero % 1000;
  const partes: string[] = [];
  if (millones > 0) partes.push(millones === 1 ? "un millón" : `${menorMil(millones)} millones`);
  if (miles > 0) partes.push(miles === 1 ? "mil" : `${menorMil(miles)} mil`);
  if (resto > 0) partes.push(menorMil(resto));
  return partes.join(" ").replace(/\s+/g, " ").trim();
}

// ── Render ──────────────────────────────────────────────────────────────────

export function renderFacturaTicketHTML(d: FacturaTicketData): string {
  const fontPx = d.widthMm === 58 ? 11 : 12;
  const totalIva = d.liq.iva_5 + d.liq.iva_10;
  const cond = d.condicion === "credito" ? "CRÉDITO" : "CONTADO";

  const itemsHtml = d.items
    .map((it) => {
      return `<tr class="it">
          <td class="qty"><strong>${it.cantidad}×</strong></td>
          <td class="name">${esc(it.descripcion)}</td>
          <td class="amt">${gs(it.totalLinea)}</td>
        </tr>
        <tr class="sub"><td></td><td colspan="2">${it.cantidad} × ${gs(it.precioUnitario)} ${ivaTag(it.tipo_iva)}</td></tr>`;
    })
    .join("");

  const clienteNombre = d.cliente?.nombre?.trim() || "SIN NOMBRE";
  const clienteRuc = d.cliente?.ruc?.trim() || "—";

  const avisoBorrador = d.borrador
    ? `<div class="borrador">*** SIN VALIDEZ FISCAL ***<br>Borrador — ${esc(d.motivoBorrador || "autoimpresor inactivo")}</div>`
    : "";

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8" />
<title>Factura ${esc(d.numeroCompleto)} — ${esc(d.emisor.razon_social)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: ui-monospace, "Courier New", monospace; font-size: ${fontPx}px; color:#000; background:#f1f1f1; margin:0; padding:20px; }
  .paper { background:#fff; width:${d.widthMm}mm; margin:0 auto; padding:6mm 4mm; box-shadow:0 1px 4px rgba(0,0,0,.1); }
  .logo { text-align:center; }
  .logo img { max-width:${d.widthMm === 58 ? 130 : 150}px; max-height:70px; width:auto; height:auto; object-fit:contain; display:inline-block; margin:0 auto 3px; }
  .rs { text-align:center; font-weight:700; font-size:${fontPx + 1}px; }
  .em { text-align:center; font-size:${fontPx - 1}px; }
  hr { border:none; border-top:1px dashed #000; margin:2mm 0; }
  .doc-title { text-align:center; font-weight:800; font-size:${fontPx + 2}px; letter-spacing:1px; }
  .doc-num { text-align:center; font-weight:700; font-size:${fontPx + 1}px; }
  .kv { font-size:${fontPx - 1}px; }
  .kv div { display:flex; justify-content:space-between; gap:6px; }
  table { width:100%; border-collapse:collapse; }
  td { vertical-align:top; padding:0.4mm 0; }
  td.qty { width:8mm; }
  td.amt { text-align:right; white-space:nowrap; }
  tr.sub td { color:#333; font-size:${fontPx - 2}px; padding-bottom:1mm; }
  .tot { font-size:${fontPx - 1}px; }
  .tot div { display:flex; justify-content:space-between; gap:6px; }
  .tot .big { font-weight:800; font-size:${fontPx + 2}px; border-top:1px solid #000; padding-top:1mm; margin-top:1mm; }
  .liq { font-size:${fontPx - 1}px; }
  .liq div { display:flex; justify-content:space-between; gap:6px; }
  .letras { font-size:${fontPx - 1}px; margin-top:1mm; }
  .borrador { text-align:center; font-weight:800; color:#b91c1c; font-size:${fontPx}px; margin:2mm 0; }
  .foot { text-align:center; font-size:${fontPx - 2}px; margin-top:3mm; }
  .actions { max-width:${d.widthMm}mm; margin:8mm auto 0; text-align:center; }
  .actions button { padding:8px 16px; font-size:13px; cursor:pointer; border:1px solid #333; background:#fff; border-radius:6px; }
  .actions a { margin-left:12px; font-size:13px; color:#444; }
  @media print { body { background:#fff; padding:0; } .paper { width:${d.widthMm}mm; box-shadow:none; padding:2mm; margin:0; } .actions { display:none; } @page { margin:0; size:${d.widthMm}mm auto; } }
</style></head>
<body>
  <section class="paper">
    ${membreteTicket(d.origin)}
    <div class="rs">${esc(d.emisor.razon_social)}</div>
    <div class="em">RUC: ${esc(d.emisor.ruc)}</div>
    <hr>
    <div class="doc-title">FACTURA</div>
    <div class="doc-num">${esc(d.numeroCompleto)}</div>
    <div class="kv" style="margin-top:1mm;">
      <div><span>Timbrado</span><span>${esc(d.timbrado.numero)}</span></div>
      <div><span>Vigencia</span><span>${esc(fechaCorta(d.timbrado.inicio))} a ${esc(fechaCorta(d.timbrado.fin))}</span></div>
      <div><span>Fecha</span><span>${esc(fechaHora(d.fechaEmision))}</span></div>
      <div><span>Condición</span><span>${cond}</span></div>
    </div>
    <hr>
    <div class="kv">
      <div><span>Cliente</span><span>${esc(clienteNombre)}</span></div>
      <div><span>RUC / CI</span><span>${esc(clienteRuc)}</span></div>
    </div>
    <hr>
    <table><tbody>${itemsHtml}</tbody></table>
    <hr>
    <div class="tot">
      <div><span>Exentas</span><span>${gs(d.liq.exentas)}</span></div>
      <div><span>Gravadas 5%</span><span>${gs(d.liq.gravado_5)}</span></div>
      <div><span>Gravadas 10%</span><span>${gs(d.liq.gravado_10)}</span></div>
      <div class="big"><span>TOTAL</span><span>${gs(d.liq.total)}</span></div>
    </div>
    <hr>
    <div class="liq">
      <div><span>Liq. IVA 5%</span><span>${gs(d.liq.iva_5)}</span></div>
      <div><span>Liq. IVA 10%</span><span>${gs(d.liq.iva_10)}</span></div>
      <div><span>Total IVA</span><span>${gs(totalIva)}</span></div>
    </div>
    <div class="letras">Son: ${esc(numeroALetras(d.liq.total))} guaraníes.</div>
    ${avisoBorrador}
    ${!d.borrador ? `<div class="foot" style="font-style:italic;">¡Gracias por su compra!</div>` : ""}
    <div class="foot">
      Venta ${esc(d.ventaNumeroControl)}${d.borrador ? " · DOCUMENTO DE PRUEBA" : ""}
    </div>
  </section>
  <div class="actions">
    <button type="button" onclick="window.print()">Imprimir</button>
    <a href="?w=${d.widthMm === 80 ? 58 : 80}${d.borrador ? "&preview=1" : ""}">Cambiar a ${d.widthMm === 80 ? 58 : 80}mm</a>
  </div>
  <script>try{ if(new URL(location.href).searchParams.get('auto')==='1'){ setTimeout(function(){window.print();},250); } }catch(e){}</script>
</body></html>`;
}
