import fs from "node:fs";
import path from "node:path";
import { create as fontkitCreate, type Font as FontkitFont } from "fontkit";

/**
 * Sharp usa librsvg: no aplica @font-face/CSS embebido; el texto sale como □.
 * Convertimos el texto a `<path d="…"/>`. **opentype.js** falla con Inter moderno
 * (`substFormat: 2 is not yet supported` en GSUB); **fontkit** sí maqueta bien.
 *
 * En Vercel/serverless, `node_modules/@fontsource/…` puede no ir en el bundle:
 * fuentes copiadas en `public/sorteos-ticket-fonts/` (desplegadas siempre).
 *
 * Uso app: `sorteo-ticket-text-path.ts` (server-only). Scripts QA importan este archivo.
 */
export type TicketPathWeight = 400 | 600 | 700 | 800;

const FILE_BY_WEIGHT: Record<TicketPathWeight, string> = {
  400: "inter-latin-400-normal.woff",
  600: "inter-latin-600-normal.woff",
  700: "inter-latin-700-normal.woff",
  800: "inter-latin-800-normal.woff",
};

/** Cache por peso (misma familia Inter). */
const fontCache = new Map<TicketPathWeight, FontkitFont>();

function resolveInterWoff(weight: TicketPathWeight): string {
  const name = FILE_BY_WEIGHT[weight];
  const candidates = [
    path.join(process.cwd(), "public/sorteos-ticket-fonts", name),
    path.join(process.cwd(), "node_modules/@fontsource/inter/files", name),
  ];
  for (const fp of candidates) {
    if (fs.existsSync(fp)) return fp;
  }
  throw new Error(
    `Inter WOFF no encontrado (${name}). Probado:\n${candidates.map((p) => ` - ${p}`).join("\n")}`
  );
}

export function normalizeTicketFontWeight(w: number): TicketPathWeight {
  if (w <= 450) return 400;
  if (w <= 650) return 600;
  if (w <= 750) return 700;
  return 800;
}

export function getSorteoInterFont(weight: number): FontkitFont {
  const w = normalizeTicketFontWeight(weight);
  const cached = fontCache.get(w);
  if (cached) return cached;
  const fp = resolveInterWoff(w);
  const raw = fontkitCreate(fs.readFileSync(fp));
  const font = raw as FontkitFont;
  fontCache.set(w, font);
  return font;
}

function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * Devuelve `<path …/>` o cadena vacía. `y` = línea base (como `<text y>` en SVG).
 */
export function svgTextAsPath(opts: {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  weight: number;
  fill: string;
  textAnchor?: "start" | "middle";
}): string {
  const t = opts.text.replace(/\s+/g, " ").trim();
  if (!t) return "";
  try {
    const font = getSorteoInterFont(opts.weight);
    const fontSize = opts.fontSize;
    const scale = fontSize / font.unitsPerEm;
    const run = font.layout(t);

    let totalAdv = 0;
    for (const pos of run.positions) {
      totalAdv += pos.xAdvance;
    }

    let startX = opts.x;
    if (opts.textAnchor === "middle") {
      startX = opts.x - (totalAdv * scale) / 2;
    }

    let xPen = 0;
    const dParts: string[] = [];
    for (let i = 0; i < run.glyphs.length; i++) {
      const glyph = run.glyphs[i]!;
      const pos = run.positions[i]!;
      const fragment = glyph.path
        .translate(xPen + pos.xOffset, pos.yOffset)
        .transform(scale, 0, 0, -scale, startX, opts.y)
        .toSVG();
      if (fragment) dParts.push(fragment);
      xPen += pos.xAdvance;
    }

    const dCombined = dParts.join(" ");
    if (!dCombined.trim()) return "";

    const dEsc = dCombined.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
    return `<path fill="${escAttr(opts.fill)}" d="${dEsc}"/>`;
  } catch (e) {
    console.error("[sorteo-ticket] text_path_failed", {
      message: e instanceof Error ? e.message : String(e),
      preview: t.slice(0, 80),
    });
    return "";
  }
}
