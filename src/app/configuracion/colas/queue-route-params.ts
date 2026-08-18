/** Cliente: mismo criterio que `normalizeQueueRouteId` en API (params puede ser string | string[]). */
export function queueEditorRouteId(raw: string | string[] | undefined): string {
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (first == null || typeof first !== "string") return "";
  const t = first.trim();
  if (!t) return "";
  try {
    return decodeURIComponent(t);
  } catch {
    return t;
  }
}
