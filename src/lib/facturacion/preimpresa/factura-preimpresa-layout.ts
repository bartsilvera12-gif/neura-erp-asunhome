/**
 * Maquetación de la FACTURA PREIMPRESA de ASUNHOME.
 *
 * La hoja física (216 × 330 mm) ya viene impresa con logo, datos de empresa,
 * RUC, timbrado, títulos, líneas, columnas y textos fiscales, en 3 copias
 * verticales (Original / Duplicado / Triplicado). El sistema imprime ÚNICAMENTE
 * los datos variables, posicionados en mm sobre cada copia.
 *
 * TODAS las medidas viven en `CALIB` (abajo) para calibrar en un solo lugar.
 * Los offsets iniciales se derivaron de ASUNHOME.pdf (216×330 mm exactos):
 *   · columnas y filas detectadas sobre la grilla real (líneas de la plantilla);
 *   · separación entre copias medida sobre el ancla "Nº 001-001" (y = 26.8 /
 *     132.6 / 239.6 mm → deltas 105.8 y 212.8 mm).
 *
 * Esto es SOLO maquetación/alineación: no toca venta, stock, caja, numeración
 * ni impuestos.
 */

/** Alineación horizontal de un campo respecto de su X. */
export type Align = "left" | "center" | "right";

export interface CampoPos {
  x: number; // mm desde el borde IZQUIERDO de la hoja
  y: number; // mm desde el borde SUPERIOR del bloque 1 (cada copia suma su dy)
  align?: Align;
}

/**
 * Calibración centralizada. Todo en milímetros. Ajustar acá y en ningún otro
 * lado. `bloques[i].dy` desplaza verticalmente cada copia reutilizando el mismo
 * layout. Los X/Y son del BLOQUE 1; cada copia les suma su `dy`.
 */
export const CALIB = {
  hoja: { anchoMm: 216, altoMm: 330 },

  /**
   * Desplazamiento GLOBAL de TODOS los datos (mm). Es el knob de calibración
   * rápida contra la impresora física: si todo sale corrido, ajustar acá una
   * sola vez (ej. y:+1.5 baja todo 1.5 mm; x:-1 corre todo 1 mm a la izquierda).
   */
  offset: { x: -2, y: 3 },

  /** Tipografía de los datos variables. */
  font: { family: "Arial, Helvetica, sans-serif", sizePt: 8.5 },

  /** Las 3 copias: mismo layout, distinto desplazamiento vertical. */
  bloques: [{ dy: 0 }, { dy: 105.8 }, { dy: 212.8 }] as Array<{ dy: number }>,

  /** Cabecera (datos de cliente y condición) — posiciones del bloque 1. */
  cabecera: {
    fecha: { x: 52, y: 32.8, align: "left" } as CampoPos,
    nombre: { x: 66, y: 37.5, align: "left" } as CampoPos,
    domicilio: { x: 40, y: 42.2, align: "left" } as CampoPos,
    observacion: { x: 46, y: 46.9, align: "left" } as CampoPos,
    // Marca ("X") centrada SOBRE la palabra CONTADO o CRÉDITO según la condición.
    condContado: { x: 166, y: 32.6, align: "center" } as CampoPos,
    condCredito: { x: 197, y: 32.6, align: "center" } as CampoPos,
    ruc: { x: 180, y: 37.5, align: "left" } as CampoPos,
    formaPago: { x: 167, y: 42.2, align: "left" } as CampoPos,
    notaRemision: { x: 167, y: 46.9, align: "left" } as CampoPos,
    /**
     * Correlativo del Nº de factura. APAGADO por defecto: en ASUNHOME la hoja
     * física ya viene numerada (timbrado "del 4.951 al 5.450"), así que NO se
     * imprime para no duplicar/desalinear un dato fiscal. Si algún día la hoja
     * trae solo "001-001", poner mostrar=true y calibrar x/y.
     */
    numeroFactura: { mostrar: false, x: 173, y: 27.6, align: "left" as Align },
  },

  /** Tabla de ítems. El cuerpo va de ~55.4 a ~89.9 mm (≈ 7 filas). */
  tabla: {
    yPrimeraFila: 56.6, // top de la 1ª línea de producto
    altoFila: 4.6,
    maxFilas: 7,
    cols: {
      cantidad: { x: 19.4, align: "center" as Align }, // 14.1 .. 24.7
      descripcion: { x: 26.5, align: "left" as Align }, // 24.7 .. 130.7
      precio: { x: 148.5, align: "right" as Align }, // 130.7 .. 150.2
      exenta: { x: 167, align: "right" as Align }, // 150.2 .. 168.7
      iva5: { x: 187, align: "right" as Align }, // 168.7 .. 189
      iva10: { x: 207, align: "right" as Align }, // 189 .. 209
    },
    /** Máximo de caracteres de descripción para no invadir la columna PRECIO. */
    descMaxChars: 52,
  },

  /** Totales (fila SUBTOTAL 89.9, TOTAL A PAGAR 94.3, LIQUIDACIÓN 99.1). */
  totales: {
    subExenta: { x: 167, y: 90.7, align: "right" } as CampoPos,
    subIva5: { x: 187, y: 90.7, align: "right" } as CampoPos,
    subIva10: { x: 207, y: 90.7, align: "right" } as CampoPos,
    totalPagar: { x: 207, y: 95.4, align: "right" } as CampoPos, // TOTAL A PAGAR Gs.
    liq5: { x: 78, y: 100.2, align: "left" } as CampoPos, // (5%) ___
    liq10: { x: 138, y: 100.2, align: "left" } as CampoPos, // (10%) ___
    totalIva: { x: 207, y: 100.2, align: "right" } as CampoPos, // TOTAL IVA:
  },
};

export interface FacturaPreimpresaItem {
  cantidad: number;
  descripcion: string;
  precioUnitario: number;
  exenta: number;
  iva5: number;
  iva10: number;
}

export interface FacturaPreimpresaData {
  fecha: string; // "15/09/2026"
  nombre: string;
  domicilio: string;
  observacion: string;
  condicion: "CONTADO" | "CREDITO";
  ruc: string;
  formaPago: string;
  notaRemision: string;
  numeroFactura?: string; // solo se pinta si CALIB.cabecera.numeroFactura.mostrar
  items: FacturaPreimpresaItem[];
  totExenta: number;
  totIva5: number;
  totIva10: number;
  totalPagar: number;
  liq5: number;
  liq10: number;
  totalIva: number;
}

export interface RenderOpts {
  /** Modo calibración (solo dev): muestra la plantilla de fondo. NO en impresión real. */
  calibrar?: boolean;
  /** No disparar window.print() automáticamente (para revisar en pantalla). */
  ver?: boolean;
  /** URL de la imagen de la plantilla (solo para calibrar). */
  bgUrl?: string;
}

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function fmtGs(v: number): string {
  return Math.round(Number(v) || 0).toLocaleString("es-PY");
}

/** Un dato variable posicionado en mm dentro de un bloque (dy). */
function campo(pos: CampoPos, dy: number, text: string): string {
  if (text === "" || text == null) return "";
  const x = pos.x + CALIB.offset.x;
  const y = pos.y + dy + CALIB.offset.y;
  const align = pos.align ?? "left";
  let style = `top:${y}mm;`;
  if (align === "right") style += `right:${CALIB.hoja.anchoMm - x}mm;text-align:right;`;
  else if (align === "center") style += `left:${x}mm;transform:translateX(-50%);text-align:center;`;
  else style += `left:${x}mm;`;
  return `<div class="f" style="${style}">${escapeHtml(text)}</div>`;
}

/** Renderiza UNA copia (bloque) con el desplazamiento vertical dado. */
function renderBloque(d: FacturaPreimpresaData, dy: number): string {
  const c = CALIB.cabecera;
  const parts: string[] = [];

  // Cabecera
  parts.push(campo(c.fecha, dy, d.fecha));
  parts.push(campo(c.nombre, dy, d.nombre));
  parts.push(campo(c.domicilio, dy, d.domicilio));
  parts.push(campo(c.observacion, dy, d.observacion));
  parts.push(campo(c.ruc, dy, d.ruc));
  parts.push(campo(c.formaPago, dy, d.formaPago));
  parts.push(campo(c.notaRemision, dy, d.notaRemision));
  // Marca de condición de venta
  parts.push(campo(d.condicion === "CREDITO" ? c.condCredito : c.condContado, dy, "X"));
  // Nº de factura (solo si está habilitado)
  if (c.numeroFactura.mostrar && d.numeroFactura) {
    parts.push(campo({ x: c.numeroFactura.x, y: c.numeroFactura.y, align: c.numeroFactura.align }, dy, d.numeroFactura));
  }

  // Tabla de ítems
  const t = CALIB.tabla;
  const filas = d.items.slice(0, t.maxFilas);
  filas.forEach((it, i) => {
    const y = t.yPrimeraFila + i * t.altoFila;
    parts.push(campo({ x: t.cols.cantidad.x, y, align: t.cols.cantidad.align }, dy, String(it.cantidad)));
    const desc = it.descripcion.length > t.descMaxChars ? it.descripcion.slice(0, t.descMaxChars) : it.descripcion;
    parts.push(campo({ x: t.cols.descripcion.x, y, align: t.cols.descripcion.align }, dy, desc));
    parts.push(campo({ x: t.cols.precio.x, y, align: t.cols.precio.align }, dy, fmtGs(it.precioUnitario)));
    if (it.exenta > 0) parts.push(campo({ x: t.cols.exenta.x, y, align: t.cols.exenta.align }, dy, fmtGs(it.exenta)));
    if (it.iva5 > 0) parts.push(campo({ x: t.cols.iva5.x, y, align: t.cols.iva5.align }, dy, fmtGs(it.iva5)));
    if (it.iva10 > 0) parts.push(campo({ x: t.cols.iva10.x, y, align: t.cols.iva10.align }, dy, fmtGs(it.iva10)));
  });

  // Totales
  const to = CALIB.totales;
  if (d.totExenta > 0) parts.push(campo(to.subExenta, dy, fmtGs(d.totExenta)));
  if (d.totIva5 > 0) parts.push(campo(to.subIva5, dy, fmtGs(d.totIva5)));
  if (d.totIva10 > 0) parts.push(campo(to.subIva10, dy, fmtGs(d.totIva10)));
  parts.push(campo(to.totalPagar, dy, fmtGs(d.totalPagar)));
  if (d.liq5 > 0) parts.push(campo(to.liq5, dy, fmtGs(d.liq5)));
  if (d.liq10 > 0) parts.push(campo(to.liq10, dy, fmtGs(d.liq10)));
  parts.push(campo(to.totalIva, dy, fmtGs(d.totalIva)));

  return parts.join("\n");
}

/** HTML autocontenido, listo para imprimir (o calibrar). */
export function renderFacturaPreimpresa(d: FacturaPreimpresaData, opts: RenderOpts = {}): string {
  const { calibrar = false, ver = false, bgUrl } = opts;
  const bloques = CALIB.bloques.map((b) => renderBloque(d, b.dy)).join("\n");
  const autoPrint = !ver && !calibrar;
  const bg = calibrar && bgUrl
    ? `<img class="plantilla-bg" src="${escapeHtml(bgUrl)}" alt="plantilla" />`
    : "";

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8" />
<title>Factura preimpresa ASUNHOME</title>
<style>
  @page { size: ${CALIB.hoja.anchoMm}mm ${CALIB.hoja.altoMm}mm; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  .hoja {
    position: relative;
    width: ${CALIB.hoja.anchoMm}mm;
    height: ${CALIB.hoja.altoMm}mm;
    overflow: hidden;
    background: #fff;
  }
  .plantilla-bg {
    position: absolute; inset: 0; z-index: 0;
    width: ${CALIB.hoja.anchoMm}mm; height: ${CALIB.hoja.altoMm}mm;
    opacity: .9; pointer-events: none;
  }
  .f {
    position: absolute; z-index: 1;
    font-family: ${CALIB.font.family};
    font-size: ${CALIB.font.sizePt}pt;
    line-height: 1; color: #000; white-space: nowrap;
  }
  @media screen {
    body { background: #9aa0a6; }
    .hoja { margin: 12px auto; box-shadow: 0 0 10px rgba(0,0,0,.4); }
  }
  @media print {
    /* Nunca imprimir la plantilla de fondo: solo los valores. */
    .plantilla-bg { display: none !important; }
    .hoja { margin: 0; box-shadow: none; }
  }
</style></head>
<body>
  ${autoPrint ? `<script>window.addEventListener("load",function(){setTimeout(function(){window.print();},250);});</script>` : ""}
  <div class="hoja">
    ${bg}
    ${bloques}
  </div>
</body></html>`;
}
