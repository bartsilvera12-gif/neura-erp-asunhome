/**
 * Valida que las fuentes Inter estén legibles en disco y que Sharp rasterice paths con texto visible.
 * Ejecutar antes de dar por cerrado el ticket de WhatsApp:
 *
 *   npm run verify:sorteo-ticket-overlay
 *
 * Falla si no hay path SVG, PNG vacío o sin tinta oscura sobre fondo claro.
 */
import fs from "node:fs";
import path from "node:path";

import sharp from "sharp";

import { svgTextAsPath } from "../src/lib/sorteos/sorteo-ticket-font-svg-path";

async function main() {
  const cwd = process.cwd();
  const font400 = path.join(cwd, "public/sorteos-ticket-fonts/inter-latin-400-normal.woff");
  if (!fs.existsSync(font400)) {
    console.error("FALTA", font400, "— copiar desde @fontsource/inter/files");
    process.exit(1);
  }

  const sample =
    "Participante · Doc 1234567 · Tel +595981 · Orden 8 · Cupón 0020 — ñáéíóú";
  const pathEl = svgTextAsPath({
    text: sample,
    x: 540,
    y: 400,
    fontSize: 32,
    weight: 700,
    fill: "#0f172a",
    textAnchor: "middle",
  });

  if (!pathEl || pathEl.length < 80 || !pathEl.includes('d="')) {
    console.error("FALLO: svgTextAsPath no generó <path> (¿fuentes no encontradas en runtime?)");
    console.error("Salida:", pathEl || "(vacío)");
    process.exit(1);
  }

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="600" viewBox="0 0 1080 600">
  <rect width="1080" height="600" fill="#ffffff"/>
  ${pathEl}
</svg>`;

  const png = await sharp(Buffer.from(svg, "utf8")).png().toBuffer();
  if (png.length < 2000) {
    console.error("FALLO: PNG sospechosamente pequeño", png.length);
    process.exit(1);
  }

  const meta = await sharp(png).stats();
  const darkestMin = Math.min(
    meta.channels[0]!.min,
    meta.channels[1]!.min,
    meta.channels[2]!.min
  );
  if (darkestMin > 245) {
    console.error(
      "FALLO: PNG casi todo blanco (texto no rasterizado). min canal RGB:",
      darkestMin
    );
    process.exit(1);
  }

  const out = path.join(cwd, ".tmp-sorteo-ticket-overlay-verify.png");
  fs.writeFileSync(out, png);
  console.log("OK sorteo ticket overlay", {
    svgPathChars: pathEl.length,
    pngBytes: png.length,
    rgbMin: darkestMin,
    wrote: out,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
