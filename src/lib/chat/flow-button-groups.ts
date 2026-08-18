import { WA_META_REPLY_BUTTON_MAX } from "@/lib/chat/whatsapp-send-service";

/** Subconjunto mínimo para particionar grupos (motor + editor). */
export type FlowOptionGroupable = {
  id: string;
  label: string;
  option_value: string;
  meta_button_id: string;
  next_node_code: string | null;
  sort_order: number;
  group_title?: string | null;
  group_order?: number | null;
  option_payload?: Record<string, unknown> | null;
};

export type QuickReplyButtonGroup = {
  groupOrder: number;
  groupTitle: string;
  options: FlowOptionGroupable[];
};

export function buttonQuickReplyGroupsEnabled(options: FlowOptionGroupable[]): boolean {
  return options.some((o) => (o.group_title ?? "").trim().length > 0);
}

/**
 * Agrupa opciones por (group_order, título efectivo). Sin group_title → bucket por defecto (intro del nodo).
 */
export function partitionQuickReplyButtonGroups(
  options: FlowOptionGroupable[],
  defaultGroupTitle: string
): QuickReplyButtonGroup[] {
  const defaultTitle = (defaultGroupTitle ?? "").trim() || "Opciones";
  const sorted = [...options].sort((a, b) => {
    const ga = a.group_order ?? 0;
    const gb = b.group_order ?? 0;
    if (ga !== gb) return ga - gb;
    return (a.sort_order ?? 0) - (b.sort_order ?? 0);
  });

  const order = new Map<string, QuickReplyButtonGroup>();
  for (const o of sorted) {
    const gt = (o.group_title ?? "").trim();
    const effectiveTitle = gt || defaultTitle;
    const ord = o.group_order ?? 0;
    const key = `${ord}\u0000${effectiveTitle}`;
    let bucket = order.get(key);
    if (!bucket) {
      bucket = { groupOrder: ord, groupTitle: effectiveTitle, options: [] };
      order.set(key, bucket);
    }
    bucket.options.push(o);
  }

  return [...order.values()].sort((a, b) => {
    if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder;
    return a.groupTitle.localeCompare(b.groupTitle);
  });
}

export function validateQuickReplyGroupsMaxThree(groups: QuickReplyButtonGroup[]): string | null {
  for (const g of groups) {
    if (g.options.length > WA_META_REPLY_BUTTON_MAX) {
      return `El grupo «${g.groupTitle}» tiene ${g.options.length} botones; WhatsApp permite máximo ${WA_META_REPLY_BUTTON_MAX} respuestas rápidas por mensaje. Dividí el grupo o usá menos opciones.`;
    }
  }
  return null;
}
