export type MetaWhatsappStatusName = "sent" | "delivered" | "read" | "failed";

export type MetaWhatsappStatus = {
  id?: string;
  status?: string;
  timestamp?: string;
  recipient_id?: string;
  conversation?: { id?: string; origin?: { type?: string } };
  pricing?: { billable?: boolean; pricing_model?: string; category?: string };
  errors?: Array<{
    code?: string | number;
    title?: string;
    message?: string;
    error_data?: { details?: string };
  }>;
};

export type MetaWebhookStatusValue = {
  messaging_product?: string;
  metadata?: {
    display_phone_number?: string;
    phone_number_id?: string;
  };
  statuses?: MetaWhatsappStatus[];
};

const STATUS_RANK: Record<MetaWhatsappStatusName, number> = {
  failed: 1,
  sent: 1,
  delivered: 2,
  read: 3,
};

export function normalizeMetaWhatsappStatus(status: string | null | undefined): MetaWhatsappStatusName | null {
  const s = (status ?? "").trim().toLowerCase();
  return s === "sent" || s === "delivered" || s === "read" || s === "failed" ? s : null;
}

export function shouldApplyWhatsappStatus(
  currentRaw: string | null | undefined,
  next: MetaWhatsappStatusName
): boolean {
  const current = normalizeMetaWhatsappStatus(currentRaw);
  if (!current) return true;
  if (current === next) return false;
  if (current === "read") return false;
  if (current === "delivered" && (next === "sent" || next === "failed")) return false;
  if (current === "failed" && next === "sent") return false;
  return STATUS_RANK[next] > STATUS_RANK[current] || next === "failed";
}

export function metaStatusTimestampToIso(timestamp: string | null | undefined): string | null {
  const raw = (timestamp ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

export function firstMetaStatusError(status: MetaWhatsappStatus): { code: string | null; message: string | null } {
  const err = status.errors?.[0] ?? null;
  if (!err) return { code: null, message: null };
  const code = err.code == null ? null : String(err.code).trim() || null;
  const message =
    err.message?.trim() ||
    err.title?.trim() ||
    err.error_data?.details?.trim() ||
    null;
  return { code, message };
}

export function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

export function compactMetaStatusPayload(
  status: MetaWhatsappStatus,
  receivedAt: string
): Record<string, unknown> {
  const error = firstMetaStatusError(status);
  return {
    id: status.id ?? null,
    status: normalizeMetaWhatsappStatus(status.status) ?? status.status ?? null,
    timestamp: status.timestamp ?? null,
    timestamp_iso: metaStatusTimestampToIso(status.timestamp),
    recipient_id: status.recipient_id ?? null,
    conversation_id: status.conversation?.id ?? null,
    conversation_origin: status.conversation?.origin?.type ?? null,
    pricing_category: status.pricing?.category ?? null,
    pricing_model: status.pricing?.pricing_model ?? null,
    billable: status.pricing?.billable ?? null,
    error_code: error.code,
    error_message: error.message,
    received_at: receivedAt,
  };
}

function pushStatusValue(out: MetaWebhookStatusValue[], value: unknown): void {
  if (!value || typeof value !== "object") return;
  const v = value as MetaWebhookStatusValue;
  if (Array.isArray(v.statuses) && v.statuses.length > 0) out.push(v);
}

/**
 * Extrae status webhooks de Meta sin mezclarlos con mensajes inbound.
 * Meta suele enviarlos como `entry[].changes[].field === "messages"` con `value.statuses[]`;
 * también toleramos proxies que reenvíen `field === "statuses"` o el `value` plano.
 */
export function collectMetaWebhookStatusValues(body: unknown): MetaWebhookStatusValue[] {
  const out: MetaWebhookStatusValue[] = [];
  if (!body || typeof body !== "object") return out;

  if (Array.isArray(body)) {
    for (const item of body) {
      out.push(...collectMetaWebhookStatusValues(item));
    }
    return out;
  }

  const root = body as Record<string, unknown>;
  const entries = (root.entry as Array<{ changes?: unknown[] }> | undefined) ?? [];
  for (const ent of entries) {
    const changes = ent.changes ?? [];
    for (const ch of changes) {
      const change = ch as { value?: unknown; field?: string };
      const field = (change.field ?? "").trim().toLowerCase();
      if (field === "messages" || field === "statuses") {
        pushStatusValue(out, change.value);
      }
    }
  }

  if (out.length > 0) return out;

  const field = typeof root.field === "string" ? root.field.trim().toLowerCase() : "";
  if (field === "messages" || field === "statuses") {
    pushStatusValue(out, root.value);
  }
  pushStatusValue(out, root);

  return out;
}
