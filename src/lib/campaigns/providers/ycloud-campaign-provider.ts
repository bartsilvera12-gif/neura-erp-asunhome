import "server-only";
import type { NormalizedTemplateRow } from "@/lib/campaigns/providers/types";

function extractSlots(text: string | undefined): string[] {
  const re = /\{\{(\d+)\}\}/g;
  const slots: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text ?? "")) !== null) slots.push(m[1]);
  return [...new Set(slots)].sort((a, b) => Number(a) - Number(b));
}

function extractRowsFromYCloudListPayload(raw: Record<string, unknown>): Record<string, unknown>[] {
  if (Array.isArray(raw.items)) return raw.items as Record<string, unknown>[];
  if (Array.isArray(raw.data)) return raw.data as Record<string, unknown>[];
  if (Array.isArray(raw.records)) return raw.records as Record<string, unknown>[];
  if (raw.data && typeof raw.data === "object" && !Array.isArray(raw.data)) {
    return Object.values(raw.data as Record<string, unknown>) as Record<string, unknown>[];
  }
  return [];
}

/**
 * Lista plantillas aprobadas desde YCloud (API documentada: GET /v2/whatsapp/templates + filter.wabaId).
 * Mantiene intentos legacy por compatibilidad con integraciones antiguas.
 */
export async function fetchYCloudApprovedTemplates(params: {
  apiKey: string;
  wabaId: string;
}): Promise<NormalizedTemplateRow[]> {
  const key = params.apiKey.trim();
  const waba = params.wabaId.trim();
  if (!key || !waba) return [];

  const allRaw: Record<string, unknown>[] = [];
  const limit = 100;
  let offset = 0;
  let listOk = false;

  while (true) {
    const qs = new URLSearchParams();
    qs.set("filter.wabaId", waba);
    qs.set("filter.status", "APPROVED");
    qs.set("limit", String(limit));
    qs.set("offset", String(offset));
    const url = `https://api.ycloud.com/v2/whatsapp/templates?${qs.toString()}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { "X-API-Key": key, Accept: "application/json" },
    });
    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      if (offset === 0) {
        console.warn("[ycloud-campaign-provider] templates_list_failed", {
          status: res.status,
          hint:
            typeof raw.message === "string"
              ? raw.message
              : typeof (raw.error as { message?: string } | undefined)?.message === "string"
                ? String((raw.error as { message?: string }).message)
                : undefined,
        });
      }
      break;
    }
    listOk = true;
    const page = extractRowsFromYCloudListPayload(raw);
    allRaw.push(...page);
    const pageLen = typeof raw.length === "number" ? Number(raw.length) : page.length;
    if (pageLen < limit) break;
    offset += limit;
  }

  if (listOk && allRaw.length > 0) {
    return normalizeYCloudTemplateRows(allRaw);
  }

  const legacyCandidates = [
    `https://api.ycloud.com/v2/whatsapp/wabas/${encodeURIComponent(waba)}/messageTemplates`,
    `https://api.ycloud.com/v2/whatsapp/wabas/${encodeURIComponent(waba)}/templates`,
  ];
  let lastErr: string | null = null;
  for (const url of legacyCandidates) {
    const res = await fetch(url, {
      method: "GET",
      headers: { "X-API-Key": key, Accept: "application/json" },
    });
    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      lastErr =
        typeof raw.message === "string"
          ? raw.message
          : typeof (raw.error as { message?: string } | undefined)?.message === "string"
            ? String((raw.error as { message?: string }).message)
            : `HTTP ${res.status}`;
      continue;
    }
    const rows = extractRowsFromYCloudListPayload(raw);
    const out = normalizeYCloudTemplateRows(rows);
    if (out.length > 0) return out;
  }

  if (lastErr) {
    console.warn("[ycloud-campaign-provider] legacy_templates_unavailable", { hint: lastErr });
  }
  return [];
}

function normalizeYCloudTemplateRows(rows: Record<string, unknown>[]): NormalizedTemplateRow[] {
  const out: NormalizedTemplateRow[] = [];
  for (const t of rows) {
    const name = typeof t.name === "string" ? t.name.trim() : "";
    if (!name) continue;
    const language =
      typeof t.language === "string"
        ? t.language.trim()
        : typeof (t as { languageCode?: string }).languageCode === "string"
          ? String((t as { languageCode?: string }).languageCode).trim()
          : "en";
    const status = String(t.status ?? t["approvalStatus"] ?? "").trim().toUpperCase();
    if (status && status !== "APPROVED") continue;

    const comps = Array.isArray(t.components) ? (t.components as { type?: string; text?: string }[]) : [];
    const body = comps.find((c) => String(c.type ?? "").toUpperCase() === "BODY");
    const variable_schema_json = { kind: "ycloud", body_slots: extractSlots(body?.text) };

    const official =
      typeof (t as { officialTemplateId?: string }).officialTemplateId === "string"
        ? (t as { officialTemplateId: string }).officialTemplateId.trim()
        : "";
    const idStr = typeof t.id === "string" ? t.id.trim() : "";

    out.push({
      provider_template_id: official || idStr || null,
      name,
      language,
      category: typeof t.category === "string" ? t.category : null,
      status: "APPROVED",
      components_json: comps as unknown[],
      variable_schema_json,
      provider_payload_json: { source: "ycloud_api", raw_id: t.id ?? null, officialTemplateId: official || null },
    });
  }
  return out;
}
