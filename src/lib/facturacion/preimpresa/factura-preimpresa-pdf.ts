/**
 * Genera la FACTURA PREIMPRESA de ASUNHOME como PDF de 216×330 mm exactos, con
 * SOLO los datos variables posicionados en mm. Un PDF se imprime a "Tamaño real"
 * de forma confiable (no se encoge como el HTML del navegador con márgenes).
 *
 * Reutiliza el MISMO `CALIB` que el layout HTML (única fuente de medidas), así la
 * calibración vale para ambos. Es solo maquetación: no toca datos de la venta.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { CALIB, fmtGs, type FacturaPreimpresaData } from "./factura-preimpresa-layout";

const PT_PER_MM = 2.834645669;

/** Deja solo caracteres que la fuente estándar (WinAnsi/Latin-1) puede dibujar. */
function clean(s: string): string {
  return String(s ?? "").replace(/[^\x20-\x7E\xA0-\xFF]/g, "");
}

export async function renderFacturaPreimpresaPdf(d: FacturaPreimpresaData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([CALIB.hoja.anchoMm * PT_PER_MM, CALIB.hoja.altoMm * PT_PER_MM]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const F = CALIB.font.sizePt;
  const H = CALIB.hoja.altoMm * PT_PER_MM;
  const baselineDrop = F * 0.78; // baseline desde el top del texto (≈ ascendente Helvetica)

  const draw = (xMm: number, yMm: number, text: string, align: "left" | "center" | "right" = "left") => {
    const t = clean(text);
    if (t === "") return;
    const x = (xMm + CALIB.offset.x) * PT_PER_MM;
    const yTop = (yMm + CALIB.offset.y) * PT_PER_MM;
    let width = 0;
    try {
      width = font.widthOfTextAtSize(t, F);
    } catch {
      return;
    }
    let left = x;
    if (align === "right") left = x - width;
    else if (align === "center") left = x - width / 2;
    try {
      page.drawText(t, { x: left, y: H - (yTop + baselineDrop), size: F, font, color: rgb(0, 0, 0) });
    } catch {
      /* si algún carácter no se puede dibujar, se omite ese campo, no se rompe el PDF */
    }
  };

  const c = CALIB.cabecera;
  const t = CALIB.tabla;
  const to = CALIB.totales;

  for (const b of CALIB.bloques) {
    const dy = b.dy;

    // Cabecera
    draw(c.fecha.x, c.fecha.y + dy, d.fecha, c.fecha.align);
    draw(c.nombre.x, c.nombre.y + dy, d.nombre, c.nombre.align);
    draw(c.domicilio.x, c.domicilio.y + dy, d.domicilio, c.domicilio.align);
    draw(c.observacion.x, c.observacion.y + dy, d.observacion, c.observacion.align);
    draw(c.ruc.x, c.ruc.y + dy, d.ruc, c.ruc.align);
    draw(c.formaPago.x, c.formaPago.y + dy, d.formaPago, c.formaPago.align);
    draw(c.notaRemision.x, c.notaRemision.y + dy, d.notaRemision, c.notaRemision.align);
    const cm = d.condicion === "CREDITO" ? c.condCredito : c.condContado;
    draw(cm.x, cm.y + dy, "X", cm.align);
    if (c.numeroFactura.mostrar && d.numeroFactura) {
      draw(c.numeroFactura.x, c.numeroFactura.y + dy, d.numeroFactura, c.numeroFactura.align);
    }

    // Tabla de ítems
    d.items.slice(0, t.maxFilas).forEach((it, i) => {
      const y = t.yPrimeraFila + i * t.altoFila + dy;
      draw(t.cols.cantidad.x, y, String(it.cantidad), t.cols.cantidad.align);
      const desc = it.descripcion.length > t.descMaxChars ? it.descripcion.slice(0, t.descMaxChars) : it.descripcion;
      draw(t.cols.descripcion.x, y, desc, t.cols.descripcion.align);
      draw(t.cols.precio.x, y, fmtGs(it.precioUnitario), t.cols.precio.align);
      if (it.exenta > 0) draw(t.cols.exenta.x, y, fmtGs(it.exenta), t.cols.exenta.align);
      if (it.iva5 > 0) draw(t.cols.iva5.x, y, fmtGs(it.iva5), t.cols.iva5.align);
      if (it.iva10 > 0) draw(t.cols.iva10.x, y, fmtGs(it.iva10), t.cols.iva10.align);
    });

    // Totales
    if (d.totExenta > 0) draw(to.subExenta.x, to.subExenta.y + dy, fmtGs(d.totExenta), to.subExenta.align);
    if (d.totIva5 > 0) draw(to.subIva5.x, to.subIva5.y + dy, fmtGs(d.totIva5), to.subIva5.align);
    if (d.totIva10 > 0) draw(to.subIva10.x, to.subIva10.y + dy, fmtGs(d.totIva10), to.subIva10.align);
    draw(to.totalPagar.x, to.totalPagar.y + dy, fmtGs(d.totalPagar), to.totalPagar.align);
    if (d.liq5 > 0) draw(to.liq5.x, to.liq5.y + dy, fmtGs(d.liq5), to.liq5.align);
    if (d.liq10 > 0) draw(to.liq10.x, to.liq10.y + dy, fmtGs(d.liq10), to.liq10.align);
    draw(to.totalIva.x, to.totalIva.y + dy, fmtGs(d.totalIva), to.totalIva.align);
  }

  return doc.save();
}
