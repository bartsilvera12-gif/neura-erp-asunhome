/**
 * Extrae botones QUICK_REPLY declarados en template_components_json (Meta / snapshot ERP).
 */

export type TemplateQuickReplyButton = {
  /** Identificador que debe coincidir con interactive.button_reply.id en el webhook (editable en UI). */
  suggested_button_id: string;
  label: string;
};

function slugSuggestion(label: string): string {
  const t = label.trim().toLowerCase();
  const s = t.replace(/[^\w\u00f1]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 120);
  return s || "quick_reply";
}

/**
 * Recorre componentes tipo BUTTONS y lista cada QUICK_REPLY.
 * Si el JSON trae `id` por botón, se usa como sugerencia; si no, slug del texto del botón.
 */
export function extractQuickReplyButtonsFromTemplateComponents(components: unknown): TemplateQuickReplyButton[] {
  if (!Array.isArray(components)) return [];
  const out: TemplateQuickReplyButton[] = [];
  for (const c of components) {
    const o = c as { type?: string; buttons?: unknown[] };
    if (String(o.type ?? "").toUpperCase() !== "BUTTONS" || !Array.isArray(o.buttons)) continue;
    for (const b of o.buttons) {
      const btn = b as { type?: string; text?: string; id?: string };
      const t = String(btn.type ?? "").toUpperCase();
      if (t !== "QUICK_REPLY") continue;
      const label = String(btn.text ?? "").trim() || "Botón";
      const idRaw = String(btn.id ?? "").trim();
      out.push({
        suggested_button_id: idRaw || slugSuggestion(label),
        label,
      });
    }
  }
  return out;
}
