import type { SupabaseAdmin } from "@/lib/chat/types";
import { WA_META_REPLY_BUTTON_MAX, WA_META_REPLY_TITLE_MAX } from "@/lib/chat/whatsapp-send-service";

/** Acciones configurables por botón en message_config.buttons_json (solo persistencia FASE 1). */
export type RecontactButtonAction =
  | "continuar_flujo_actual"
  | "iniciar_otro_flujo"
  | "enviar_texto"
  | "transferir_humano";

const BUTTON_ACTIONS = new Set<string>([
  "continuar_flujo_actual",
  "iniciar_otro_flujo",
  "enviar_texto",
  "transferir_humano",
]);

export type PurchaseCondition = "none" | "no_confirmed_sorteo_order";

export type RecontactGuardConfig = {
  skip_if_human_taken_over?: boolean;
  skip_if_conversation_closed?: boolean;
  purchase_condition?: PurchaseCondition;
};

export type RecontactScheduleConfig = {
  window_start?: string | null;
  window_end?: string | null;
  timezone?: string | null;
  active_weekdays?: number[] | null;
};

export type RecontactMessageConfig = {
  message_type?: "session_text" | "whatsapp_template";
  session_text?: string | null;
  template_name?: string | null;
  template_language?: string | null;
  template_components?: unknown;
  buttons_json?: unknown;
};

export type RecontactRuleRowOut = {
  id: string;
  empresa_id: string;
  flow_code: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  prioridad: number;
  included_node_codes: unknown;
  excluded_node_codes: unknown;
  idle_after_seconds: number;
  max_attempts: number;
  cooldown_seconds: number;
  schedule_config: unknown;
  guard_config: unknown;
  message_config: unknown;
  created_at: string;
  updated_at: string;
};

const PURCHASE_CONDITIONS = new Set<PurchaseCondition>(["none", "no_confirmed_sorteo_order"]);

export async function fetchNodeCodesForFlow(
  supabase: SupabaseAdmin,
  empresaId: string,
  flowCode: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from("chat_flow_nodes")
    .select("node_code")
    .eq("empresa_id", empresaId)
    .eq("flow_code", flowCode);
  if (error) throw new Error(error.message);
  const codes = new Set<string>();
  for (const row of data ?? []) {
    const c = String((row as { node_code?: string }).node_code ?? "").trim();
    if (c) codes.add(c);
  }
  return [...codes];
}

export async function assertFlowBelongsToEmpresa(
  supabase: SupabaseAdmin,
  empresaId: string,
  flowCode: string
): Promise<void> {
  const { data, error } = await supabase
    .from("chat_flows")
    .select("flow_code")
    .eq("empresa_id", empresaId)
    .eq("flow_code", flowCode)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Flujo no encontrado para esta empresa");
}

function parseStringArray(raw: unknown, field: string): string[] {
  if (raw === undefined || raw === null) return [];
  let arr: unknown[];
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === "string") {
    try {
      const j = JSON.parse(raw) as unknown;
      arr = Array.isArray(j) ? j : [];
    } catch {
      throw new Error(`${field}: JSON inválido`);
    }
  } else throw new Error(`${field}: debe ser un arreglo de códigos de nodo`);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of arr) {
    const s = typeof x === "string" ? x.trim() : String(x ?? "").trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function assertSubset(valid: Set<string>, codes: string[], field: string): void {
  for (const c of codes) {
    if (!valid.has(c)) {
      throw new Error(`${field}: el nodo «${c}» no pertenece a este flujo`);
    }
  }
}

function clampInt(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export function normalizeIdleSecondsSeconds(minutesOrSeconds: {
  idle_after_minutes?: unknown;
  idle_after_seconds?: unknown;
}): number {
  if (minutesOrSeconds.idle_after_seconds !== undefined && minutesOrSeconds.idle_after_seconds !== null) {
    const s = Number(minutesOrSeconds.idle_after_seconds);
    if (!Number.isFinite(s)) throw new Error("idle_after_seconds inválido");
    return Math.max(60, Math.trunc(s));
  }
  const m = Number(minutesOrSeconds.idle_after_minutes);
  if (!Number.isFinite(m)) throw new Error("idle_after_minutes inválido");
  return Math.max(60, Math.round(m * 60));
}

export function normalizeCooldownSeconds(minutesOrSeconds: {
  cooldown_minutes?: unknown;
  cooldown_seconds?: unknown;
}): number {
  if (minutesOrSeconds.cooldown_seconds !== undefined && minutesOrSeconds.cooldown_seconds !== null) {
    const s = Number(minutesOrSeconds.cooldown_seconds);
    if (!Number.isFinite(s)) throw new Error("cooldown_seconds inválido");
    return Math.max(60, Math.trunc(s));
  }
  const m = Number(minutesOrSeconds.cooldown_minutes);
  if (!Number.isFinite(m)) throw new Error("cooldown_minutes inválido");
  return Math.max(60, Math.round(m * 60));
}

function normalizeGuard(raw: unknown): Record<string, unknown> {
  const base: Record<string, unknown> = {
    skip_if_human_taken_over: true,
    skip_if_conversation_closed: true,
    purchase_condition: "none",
  };
  if (raw === undefined || raw === null) return base;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("guard_config inválido");
  const o = raw as Record<string, unknown>;
  if (typeof o.skip_if_human_taken_over === "boolean") base.skip_if_human_taken_over = o.skip_if_human_taken_over;
  if (typeof o.skip_if_conversation_closed === "boolean") base.skip_if_conversation_closed = o.skip_if_conversation_closed;
  const pc = o.purchase_condition;
  if (pc !== undefined && pc !== null) {
    const p = String(pc).trim() as PurchaseCondition;
    if (!PURCHASE_CONDITIONS.has(p)) throw new Error("purchase_condition inválido");
    base.purchase_condition = p;
  }
  return base;
}

function sanitizeButtonsFromDb(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) return [];
  const out: Record<string, unknown>[] = [];
  for (const item of raw.slice(0, WA_META_REPLY_BUTTON_MAX)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const label =
      typeof o.label === "string" ? o.label.trim().slice(0, WA_META_REPLY_TITLE_MAX) : "";
    const actionRaw = typeof o.action === "string" ? o.action.trim() : "";
    if (!label || !BUTTON_ACTIONS.has(actionRaw)) continue;
    const row: Record<string, unknown> = { label, action: actionRaw };
    if (typeof o.flow_code === "string" && o.flow_code.trim()) row.flow_code = o.flow_code.trim();
    if (typeof o.node_code === "string" && o.node_code.trim()) row.node_code = o.node_code.trim();
    if (typeof o.text_body === "string" && o.text_body.trim()) row.text_body = o.text_body.trim();
    out.push(row);
  }
  return out;
}

export function validateAndNormalizeButtonsJson(raw: unknown, validNodeCodes: Set<string>): unknown[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error("buttons_json debe ser un arreglo");
  if (raw.length > WA_META_REPLY_BUTTON_MAX) {
    throw new Error(`Como máximo ${WA_META_REPLY_BUTTON_MAX} botones (límite WhatsApp reply)`);
  }

  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Botón ${i + 1}: formato inválido`);
    }
    const o = item as Record<string, unknown>;
    const label = typeof o.label === "string" ? o.label.trim() : "";
    if (!label) throw new Error(`Botón ${i + 1}: el texto del botón es obligatorio`);
    if (label.length > WA_META_REPLY_TITLE_MAX) {
      throw new Error(`Botón ${i + 1}: máximo ${WA_META_REPLY_TITLE_MAX} caracteres (WhatsApp reply)`);
    }
    const action = typeof o.action === "string" ? o.action.trim() : "";
    if (!BUTTON_ACTIONS.has(action)) throw new Error(`Botón ${i + 1}: acción inválida`);

    const row: Record<string, unknown> = { label, action };

    if (action === "continuar_flujo_actual") {
      const nc = typeof o.node_code === "string" ? o.node_code.trim() : "";
      if (!nc) throw new Error(`Botón ${i + 1}: elegí el nodo destino en este flujo`);
      if (!validNodeCodes.has(nc)) throw new Error(`Botón ${i + 1}: el nodo no pertenece a este flujo`);
      row.node_code = nc;
    } else if (action === "iniciar_otro_flujo") {
      const fc = typeof o.flow_code === "string" ? o.flow_code.trim() : "";
      if (!fc) throw new Error(`Botón ${i + 1}: indicá el código del flujo destino`);
      row.flow_code = fc;
      const nc = typeof o.node_code === "string" ? o.node_code.trim() : "";
      if (!nc) throw new Error(`Botón ${i + 1}: indicá el nodo destino`);
      row.node_code = nc;
    } else if (action === "enviar_texto") {
      const tb = typeof o.text_body === "string" ? o.text_body.trim() : "";
      if (!tb) throw new Error(`Botón ${i + 1}: el texto a enviar es obligatorio`);
      row.text_body = tb;
    }

    out.push(row);
  }
  return out;
}

function normalizeSchedule(raw: unknown): Record<string, unknown> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("schedule_config inválido");
  const o = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof o.window_start === "string") out.window_start = o.window_start.trim() || null;
  if (typeof o.window_end === "string") out.window_end = o.window_end.trim() || null;
  if (typeof o.timezone === "string") out.timezone = o.timezone.trim() || null;
  if (o.active_weekdays !== undefined && o.active_weekdays !== null) {
    if (!Array.isArray(o.active_weekdays)) throw new Error("active_weekdays debe ser un arreglo");
    const days = o.active_weekdays.map((d) => clampInt(Number(d), 0, 6));
    out.active_weekdays = [...new Set(days)].sort((a, b) => a - b);
  }
  return out;
}

function normalizeMessage(raw: unknown, validNodeCodes?: Set<string>): Record<string, unknown> {
  const base: Record<string, unknown> = {
    message_type: "session_text",
    session_text: "",
    buttons_json: [],
  };
  if (raw === undefined || raw === null) return base;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("message_config inválido");
  const o = raw as Record<string, unknown>;
  const mt = o.message_type === "whatsapp_template" ? "whatsapp_template" : "session_text";
  base.message_type = mt;
  const buttonsSrc = o.buttons_json;
  const buttons =
    validNodeCodes !== undefined
      ? validateAndNormalizeButtonsJson(buttonsSrc, validNodeCodes)
      : sanitizeButtonsFromDb(buttonsSrc);
  base.buttons_json = buttons;
  if (mt === "session_text") {
    base.session_text = typeof o.session_text === "string" ? o.session_text : "";
  } else {
    base.template_name = typeof o.template_name === "string" ? o.template_name.trim() : "";
    base.template_language = typeof o.template_language === "string" ? o.template_language.trim() : "";
    base.template_components = o.template_components ?? {};
  }
  return base;
}

export type NormalizedRecontactRulePayload = {
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  prioridad: number;
  included_node_codes: string[];
  excluded_node_codes: string[];
  idle_after_seconds: number;
  max_attempts: number;
  cooldown_seconds: number;
  schedule_config: Record<string, unknown>;
  guard_config: Record<string, unknown>;
  message_config: Record<string, unknown>;
};

export function normalizeCreatePayload(
  body: Record<string, unknown>,
  validNodeCodes: Set<string>
): NormalizedRecontactRulePayload {
  const nombre = typeof body.nombre === "string" ? body.nombre.trim() : "";
  if (nombre.length < 2) throw new Error("El nombre es obligatorio (mín. 2 caracteres)");
  const descripcion =
    body.descripcion === null || body.descripcion === undefined
      ? null
      : typeof body.descripcion === "string"
        ? body.descripcion.trim() || null
        : null;
  const activo = Boolean(body.activo);
  const prioridad = clampInt(Number(body.prioridad ?? 100), 0, 999999);

  const included = parseStringArray(body.included_node_codes, "included_node_codes");
  const excluded = parseStringArray(body.excluded_node_codes, "excluded_node_codes");
  assertSubset(validNodeCodes, included, "included_node_codes");
  assertSubset(validNodeCodes, excluded, "excluded_node_codes");
  const incSet = new Set(included);
  for (const x of excluded) {
    if (incSet.has(x)) throw new Error("Un mismo nodo no puede estar incluido y excluido");
  }

  const idle_after_seconds = normalizeIdleSecondsSeconds({
    idle_after_minutes: body.idle_after_minutes,
    idle_after_seconds: body.idle_after_seconds,
  });
  const max_attempts = Math.max(1, Math.trunc(Number(body.max_attempts ?? 1)));
  if (!Number.isFinite(max_attempts)) throw new Error("max_attempts inválido");

  const cooldown_seconds = normalizeCooldownSeconds({
    cooldown_minutes: body.cooldown_minutes,
    cooldown_seconds: body.cooldown_seconds,
  });

  return {
    nombre,
    descripcion,
    activo,
    prioridad,
    included_node_codes: included,
    excluded_node_codes: excluded,
    idle_after_seconds,
    max_attempts,
    cooldown_seconds,
    schedule_config: normalizeSchedule(body.schedule_config),
    guard_config: normalizeGuard(body.guard_config),
    message_config: normalizeMessage(body.message_config, validNodeCodes),
  };
}

export function mergePatchPayload(
  existing: NormalizedRecontactRulePayload,
  body: Record<string, unknown>,
  validNodeCodes: Set<string>
): NormalizedRecontactRulePayload {
  const next = { ...existing };
  if ("nombre" in body) {
    const nombre = typeof body.nombre === "string" ? body.nombre.trim() : existing.nombre;
    if (nombre.length < 2) throw new Error("El nombre es obligatorio (mín. 2 caracteres)");
    next.nombre = nombre;
  }
  if ("descripcion" in body) {
    next.descripcion =
      body.descripcion === null || body.descripcion === undefined
        ? null
        : typeof body.descripcion === "string"
          ? body.descripcion.trim() || null
          : existing.descripcion;
  }
  if ("activo" in body && typeof body.activo === "boolean") next.activo = body.activo;
  if ("prioridad" in body) next.prioridad = clampInt(Number(body.prioridad), 0, 999999);

  if ("included_node_codes" in body || "excluded_node_codes" in body) {
    const included = parseStringArray(
      "included_node_codes" in body ? body.included_node_codes : existing.included_node_codes,
      "included_node_codes"
    );
    const excluded = parseStringArray(
      "excluded_node_codes" in body ? body.excluded_node_codes : existing.excluded_node_codes,
      "excluded_node_codes"
    );
    assertSubset(validNodeCodes, included, "included_node_codes");
    assertSubset(validNodeCodes, excluded, "excluded_node_codes");
    const incSet = new Set(included);
    for (const x of excluded) {
      if (incSet.has(x)) throw new Error("Un mismo nodo no puede estar incluido y excluido");
    }
    next.included_node_codes = included;
    next.excluded_node_codes = excluded;
  }

  if ("idle_after_minutes" in body || "idle_after_seconds" in body) {
    next.idle_after_seconds = normalizeIdleSecondsSeconds({
      idle_after_minutes: body.idle_after_minutes,
      idle_after_seconds: body.idle_after_seconds,
    });
  }
  if ("max_attempts" in body) {
    const max_attempts = Math.max(1, Math.trunc(Number(body.max_attempts)));
    if (!Number.isFinite(max_attempts)) throw new Error("max_attempts inválido");
    next.max_attempts = max_attempts;
  }
  if ("cooldown_minutes" in body || "cooldown_seconds" in body) {
    next.cooldown_seconds = normalizeCooldownSeconds({
      cooldown_minutes: body.cooldown_minutes,
      cooldown_seconds: body.cooldown_seconds,
    });
  }
  if ("schedule_config" in body) next.schedule_config = normalizeSchedule(body.schedule_config);
  if ("guard_config" in body) next.guard_config = normalizeGuard(body.guard_config);
  if ("message_config" in body) next.message_config = normalizeMessage(body.message_config, validNodeCodes);

  return next;
}

export function rowToNormalized(row: RecontactRuleRowOut): NormalizedRecontactRulePayload {
  const inc = parseStringArray(row.included_node_codes, "included_node_codes");
  const exc = parseStringArray(row.excluded_node_codes, "excluded_node_codes");
  return {
    nombre: row.nombre,
    descripcion: row.descripcion,
    activo: row.activo,
    prioridad: row.prioridad,
    included_node_codes: inc,
    excluded_node_codes: exc,
    idle_after_seconds: row.idle_after_seconds,
    max_attempts: row.max_attempts,
    cooldown_seconds: row.cooldown_seconds,
    schedule_config:
      typeof row.schedule_config === "object" && row.schedule_config !== null && !Array.isArray(row.schedule_config)
        ? (row.schedule_config as Record<string, unknown>)
        : {},
    guard_config: normalizeGuard(row.guard_config),
    message_config: normalizeMessage(row.message_config),
  };
}
