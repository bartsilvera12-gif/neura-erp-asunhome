import "server-only";

/** Nombre canónico de columna en Excel (tras normalizar). */
export const HEADER_IMAGE_URL_COLUMN_CANONICAL = "header_image_url";

export function normalizeCampaignSheetHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, "_");
}

export function findHeaderImageUrlColumnKey(headers: string[]): string | null {
  for (const h of headers) {
    if (normalizeCampaignSheetHeader(h) === HEADER_IMAGE_URL_COLUMN_CANONICAL) return h;
  }
  return null;
}

/** Lee URL de imagen desde una fila importada (compara encabezados normalizados). */
export function getHeaderImageUrlFromRow(row: Record<string, string>): string | null {
  for (const [k, v] of Object.entries(row)) {
    if (normalizeCampaignSheetHeader(k) === HEADER_IMAGE_URL_COLUMN_CANONICAL) {
      const t = String(v ?? "").trim();
      return t.length > 0 ? t : null;
    }
  }
  return null;
}

export function templateSnapshotHasHeaderImage(components: unknown): boolean {
  if (!Array.isArray(components)) return false;
  return components.some((c) => {
    const o = c as { type?: string; format?: string };
    return (
      String(o.type ?? "").toUpperCase() === "HEADER" &&
      String(o.format ?? "").toUpperCase() === "IMAGE"
    );
  });
}

export function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url.trim()).protocol === "https:";
  } catch {
    return false;
  }
}

export type HeaderImageResolution =
  | { ok: true; url: string }
  | { ok: false; reason: "missing" | "multiple" | "invalid"; message: string };

export function mergeSendConfigJson(
  existing: unknown,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  return { ...base, ...patch };
}

/** Quita claves de imagen de cabecera (p. ej. si la plantilla ya no tiene HEADER IMAGE). */
export function stripHeaderImageSendConfigKeys(cfg: Record<string, unknown>): Record<string, unknown> {
  const out = { ...cfg };
  delete out.header_image_url;
  delete out.header_image_error;
  return out;
}

function safeUrlHost(url: string): string {
  try {
    return new URL(url.trim()).hostname;
  } catch {
    return "(inválida)";
  }
}

export function logHeaderImageResolved(url: string): void {
  console.info("[campaign-image-header][url-resolved]", { host: safeUrlHost(url) });
}

export function logTemplatePayloadHeaderImage(host: string): void {
  console.info("[campaign-send][template-payload-header-image]", { host });
}

/**
 * Resolución estricta (fase 1): todas las filas válidas deben tener la misma URL https no vacía.
 * También considera send_config_json.header_image_url: debe coincidir con la única URL de filas si ambas existen.
 */
export function resolveHeaderImageUrlForCampaign(params: {
  templateComponentsJson: unknown;
  sendConfigJson: unknown;
  recipients: Array<{ status: string; row_payload_json: unknown }>;
}): HeaderImageResolution {
  if (!templateSnapshotHasHeaderImage(params.templateComponentsJson)) {
    return { ok: true, url: "" };
  }

  console.info("[campaign-image-header][detected]");

  const cfg =
    params.sendConfigJson && typeof params.sendConfigJson === "object"
      ? (params.sendConfigJson as Record<string, unknown>)
      : {};
  const fromConfig =
    typeof cfg.header_image_url === "string" ? cfg.header_image_url.trim() : "";

  const fromRowsNonEmpty: string[] = [];
  for (const r of params.recipients) {
    if (r.status === "invalid") continue;
    const row = (r.row_payload_json ?? {}) as Record<string, string>;
    const u = getHeaderImageUrlFromRow(row);
    if (u) fromRowsNonEmpty.push(u.trim());
  }

  const candidates = new Set<string>();
  if (fromConfig) candidates.add(fromConfig);
  for (const u of fromRowsNonEmpty) candidates.add(u);

  if (candidates.size === 0) {
    console.warn("[campaign-image-header][missing-url]");
    return {
      ok: false,
      reason: "missing",
      message:
        "La plantilla incluye imagen de cabecera. Configurá header_image_url en send_config o agregá la columna header_image_url en el Excel (https, una sola URL para la campaña).",
    };
  }

  if (candidates.size > 1) {
    console.warn("[campaign-image-header][multiple-urls]", { distinct: candidates.size });
    return {
      ok: false,
      reason: "multiple",
      message:
        "En esta fase la campaña admite una sola imagen. Unificá header_image_url en la campaña y en el Excel.",
    };
  }

  const url = [...candidates][0]!;
  if (!isHttpsUrl(url)) {
    console.warn("[campaign-image-header][missing-url]");
    return {
      ok: false,
      reason: "invalid",
      message: "La header_image_url debe ser una URL https válida y accesible públicamente.",
    };
  }

  logHeaderImageResolved(url);
  return { ok: true, url };
}

export function applyHeaderImageSendConfigUpdate(
  existing: unknown,
  resolution: HeaderImageResolution
): Record<string, unknown> {
  let base = mergeSendConfigJson(existing, {});
  base = stripHeaderImageSendConfigKeys(base);

  if (!resolution.ok) {
    base.header_image_error = resolution.message;
    return base;
  }

  if (resolution.url) {
    base.header_image_url = resolution.url;
  }

  return base;
}

/**
 * Valida columnas del Excel al importar: una fila por destinatario válido, misma https en todas.
 */
export function evaluateHeaderImageOnImport(params: {
  needsHeader: boolean;
  headerCol: string | null;
  /** Un valor por cada fila con teléfono válido (mismo orden que el contador `valid`). */
  valuesPerValidRow: string[];
  validCount: number;
}): HeaderImageResolution {
  if (!params.needsHeader) {
    return { ok: true, url: "" };
  }

  console.info("[campaign-image-header][detected]");

  if (!params.headerCol) {
    console.warn("[campaign-image-header][missing-url]");
    return {
      ok: false,
      reason: "missing",
      message:
        "La plantilla incluye imagen de cabecera. Agregá la columna header_image_url en el Excel con una URL https (la misma en cada fila válida).",
    };
  }

  if (params.validCount === 0) {
    return {
      ok: false,
      reason: "missing",
      message: "No hay filas con teléfono válido para validar la imagen de cabecera.",
    };
  }

  if (params.valuesPerValidRow.length !== params.validCount) {
    return {
      ok: false,
      reason: "missing",
      message: "No se pudo leer header_image_url para todas las filas válidas.",
    };
  }

  const anyEmpty = params.valuesPerValidRow.some((v) => !String(v ?? "").trim());
  if (anyEmpty) {
    console.warn("[campaign-image-header][missing-url]");
    return {
      ok: false,
      reason: "missing",
      message:
        "Todas las filas válidas deben incluir la misma header_image_url (https). Completá la columna en cada fila.",
    };
  }

  const trimmed = params.valuesPerValidRow.map((x) => String(x).trim());
  const distinct = new Set(trimmed);
  if (distinct.size !== 1) {
    console.warn("[campaign-image-header][multiple-urls]", { distinct: distinct.size });
    return {
      ok: false,
      reason: "multiple",
      message:
        "En esta fase la campaña admite una sola imagen. Todas las filas deben usar la misma header_image_url.",
    };
  }

  const url = [...distinct][0]!;
  if (!isHttpsUrl(url)) {
    return {
      ok: false,
      reason: "invalid",
      message: "La header_image_url debe ser una URL https válida y accesible públicamente.",
    };
  }

  logHeaderImageResolved(url);
  return { ok: true, url };
}
