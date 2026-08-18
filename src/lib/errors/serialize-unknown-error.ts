const MAX_DEFAULT = 480;

function trim(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 1)}…`;
}

/**
 * Convierte throws de PostgREST, Auth o objetos planos en un string legible (nunca "[object Object]").
 */
export function serializeUnknownError(error: unknown, maxLen = MAX_DEFAULT): string {
  if (error === undefined) return "undefined";
  if (error === null) return "null";
  if (typeof error === "string") return trim(error, maxLen);
  if (typeof error === "number" || typeof error === "boolean") return String(error);

  if (error instanceof Error) {
    const combined =
      error.name && error.name !== "Error"
        ? `${error.name}: ${error.message}`
        : error.message || "(Error sin mensaje)";
    return trim(combined, maxLen);
  }

  if (typeof error === "object" && error !== null) {
    const o = error as Record<string, unknown>;
    const parts: string[] = [];

    if (typeof o.message === "string" && o.message.length > 0) parts.push(o.message);
    if (typeof o.name === "string" && o.name.length > 0 && o.name !== "Error") {
      parts.push(`name=${o.name}`);
    }

    const sc = o.status ?? o.statusCode;
    if (typeof sc === "number") parts.push(`status=${sc}`);
    if (typeof sc === "string") parts.push(`status=${sc}`);

    if (typeof o.error === "string") parts.push(o.error);
    else if (o.error && typeof o.error === "object") {
      const ie = o.error as Record<string, unknown>;
      if (typeof ie.message === "string") parts.push(String(ie.message));
    }

    if (typeof o.details === "string" && o.details.length > 0) parts.push(`details=${o.details}`);
    if (typeof o.hint === "string" && o.hint.length > 0) parts.push(`hint=${o.hint}`);
    if (typeof o.code === "string" && o.code.length > 0) parts.push(`code=${o.code}`);

    if (parts.length > 0) return trim(parts.join(" — "), maxLen);

    try {
      return trim(JSON.stringify(error), maxLen);
    } catch {
      return trim(Object.prototype.toString.call(error), maxLen);
    }
  }

  return trim(String(error), maxLen);
}

/** Para logs de diagnóstico sin volcar el objeto completo. */
export function getUnknownErrorKeys(error: unknown): string {
  if (error && typeof error === "object" && !Array.isArray(error)) {
    return Object.keys(error as object).sort().join(",");
  }
  return "";
}
