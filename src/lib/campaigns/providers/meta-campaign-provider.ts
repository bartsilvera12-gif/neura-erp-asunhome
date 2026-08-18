import "server-only";
import type { NormalizedTemplateRow } from "@/lib/campaigns/providers/types";

type MetaTemplateComponent = {
  type?: string;
  text?: string;
  format?: string;
};

function extractVariableSlotsFromText(text: string | undefined): string[] {
  if (!text) return [];
  const re = /\{\{(\d+)\}\}/g;
  const slots: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    slots.push(m[1]);
  }
  return [...new Set(slots)].sort((a, b) => Number(a) - Number(b));
}

function buildVariableSchema(components: MetaTemplateComponent[]): Record<string, unknown> {
  const body = components.find((c) => String(c.type ?? "").toUpperCase() === "BODY");
  const slots = extractVariableSlotsFromText(body?.text);
  return { kind: "meta", body_slots: slots };
}

function mapMetaRow(t: Record<string, unknown>): NormalizedTemplateRow | null {
  const name = typeof t.name === "string" ? t.name.trim() : "";
  if (!name) return null;
  const langRaw = t.language as string | undefined;
  const language =
    typeof langRaw === "string"
      ? langRaw.trim()
      : typeof (t as { language?: { code?: string } }).language?.code === "string"
        ? String((t as { language?: { code?: string } }).language?.code).trim()
        : "en";
  const status = typeof t.status === "string" ? t.status.trim().toUpperCase() : "UNKNOWN";
  const category =
    typeof t.category === "string"
      ? t.category.trim()
      : typeof (t as { category?: string }).category === "string"
        ? String((t as { category?: string }).category)
        : null;
  const id = typeof t.id === "string" ? t.id : null;
  const comps = Array.isArray(t.components) ? (t.components as MetaTemplateComponent[]) : [];
  return {
    provider_template_id: id,
    name,
    language,
    category,
    status,
    components_json: comps as unknown[],
    variable_schema_json: buildVariableSchema(comps),
    provider_payload_json: { source: "meta_graph", id },
  };
}

export async function fetchMetaApprovedTemplates(params: {
  wabaId: string;
  accessToken: string;
  graphVersion?: string;
}): Promise<NormalizedTemplateRow[]> {
  const v = params.graphVersion ?? process.env.WHATSAPP_GRAPH_VERSION ?? "v19.0";
  const base = `https://graph.facebook.com/${v}/${encodeURIComponent(params.wabaId.trim())}/message_templates`;
  const out: NormalizedTemplateRow[] = [];
  let url: string | null =
    `${base}?fields=name,language,status,category,components,id&limit=100&access_token=${encodeURIComponent(params.accessToken)}`;

  for (let guard = 0; guard < 20 && url; guard++) {
    const res = await fetch(url, { method: "GET" });
    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const msg =
        typeof raw.error === "object" && raw.error && "message" in (raw.error as object)
          ? String((raw.error as { message?: string }).message)
          : res.statusText;
      throw new Error(msg || `Meta templates HTTP ${res.status}`);
    }
    const data = raw.data as Record<string, unknown>[] | undefined;
    for (const row of data ?? []) {
      const m = mapMetaRow(row);
      if (m && m.status === "APPROVED") out.push(m);
    }
    const paging = raw.paging as { next?: string } | undefined;
    url = typeof paging?.next === "string" && paging.next.trim() ? paging.next.trim() : null;
  }

  return out;
}
