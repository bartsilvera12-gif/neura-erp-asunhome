/** Tipos y etiquetas UI para simulación dry-run (seguro para importar en Client Components). */

/** Máximo de conversaciones evaluadas por solicitud dry-run (coste acotado). */
export const RECONTACT_DRY_RUN_CONVERSATION_LIMIT = 200;

export type RecontactDryRunSkipReason =
  | "node_not_in_rule"
  | "conversation_closed"
  | "human_takeover"
  | "not_bot_flow_status"
  | "not_enough_idle_time"
  | "purchase_exists"
  | "cooldown_active"
  | "max_attempts_reached"
  | "no_active_session"
  | "missing_last_inbound";

/** Etiquetas para UI (simulación dry-run). */
export const RECONTACT_DRY_RUN_SKIP_LABELS: Record<RecontactDryRunSkipReason, string> = {
  node_not_in_rule: "El nodo actual no está incluido en la regla",
  conversation_closed: "Conversación cerrada",
  human_takeover: "Tomada por humano (human_taken_over)",
  not_bot_flow_status: "El flujo no está en modo bot",
  not_enough_idle_time: "Aún no cumple el tiempo de inactividad configurado",
  purchase_exists: "Ya existe orden sorteo confirmada",
  cooldown_active: "Período de espera entre intentos (cooldown)",
  max_attempts_reached: "Se alcanzó el máximo de intentos",
  no_active_session: "Sin sesión de flujo activa",
  missing_last_inbound: "Sin mensaje entrante del cliente registrado",
};

export type RecontactDryRunRow = {
  conversation_id: string;
  contact_name: string | null;
  phone_masked: string | null;
  current_node: string | null;
  last_inbound_at: string | null;
  idle_minutes: number | null;
  status: "candidate" | "skipped";
  skip_reason: RecontactDryRunSkipReason | null;
  human_taken_over: boolean;
  flow_status: string;
  has_confirmed_purchase: boolean;
};

export type RecontactDryRunResult = {
  scanned: number;
  limit: number;
  limitReached: boolean;
  candidates: number;
  skipped: number;
  rows: RecontactDryRunRow[];
};

export function maskChatPhone(raw: string | null | undefined): string | null {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.length <= 4) return "****";
  return `${"*".repeat(Math.min(8, d.length - 4))}${d.slice(-4)}`;
}
