/**
 * Configuración operativa persistida en `chat_queues.routing_config` (jsonb).
 * La lógica de routing puede leer estos camos en etapas posteriores.
 */

export type InitialNoResponseUnit = "minutes" | "hours";
export type InitialNoResponseAction = "reassign_auto" | "reassign_prepare";

export type SameAdvisorUnit = "hours" | "days";

export type QueueInitialNoResponseConfig = {
  enabled: boolean;
  value: number;
  unit: InitialNoResponseUnit;
  action: InitialNoResponseAction;
};

export type QueueSameAdvisorConfig = {
  enabled: boolean;
  value: number;
  unit: SameAdvisorUnit;
};

export type QueueRoutingConfig = {
  initial_no_response?: QueueInitialNoResponseConfig;
  same_advisor_window?: QueueSameAdvisorConfig;
};

export const DEFAULT_QUEUE_ROUTING_CONFIG: QueueRoutingConfig = {
  initial_no_response: {
    enabled: false,
    value: 15,
    unit: "minutes",
    action: "reassign_prepare",
  },
  same_advisor_window: {
    enabled: false,
    value: 24,
    unit: "hours",
  },
};

export function parseQueueRoutingConfig(raw: unknown): QueueRoutingConfig {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_QUEUE_ROUTING_CONFIG };
  }
  const o = raw as Record<string, unknown>;
  const def = DEFAULT_QUEUE_ROUTING_CONFIG;
  const in0 = (o.initial_no_response ?? {}) as Record<string, unknown>;
  const sa0 = (o.same_advisor_window ?? {}) as Record<string, unknown>;
  return {
    initial_no_response: {
      enabled: Boolean(in0.enabled),
      value: Math.max(1, Number(in0.value) || def.initial_no_response!.value),
      unit: in0.unit === "hours" ? "hours" : "minutes",
      action: in0.action === "reassign_auto" ? "reassign_auto" : "reassign_prepare",
    },
    same_advisor_window: {
      enabled: Boolean(sa0.enabled),
      value: Math.max(1, Number(sa0.value) || def.same_advisor_window!.value),
      unit: sa0.unit === "days" ? "days" : "hours",
    },
  };
}

export function serializeQueueRoutingConfig(c: QueueRoutingConfig): Record<string, unknown> {
  return {
    initial_no_response: {
      enabled: Boolean(c.initial_no_response?.enabled),
      value: Math.max(1, Number(c.initial_no_response?.value) || 15),
      unit: c.initial_no_response?.unit === "hours" ? "hours" : "minutes",
      action: c.initial_no_response?.action === "reassign_auto" ? "reassign_auto" : "reassign_prepare",
    },
    same_advisor_window: {
      enabled: Boolean(c.same_advisor_window?.enabled),
      value: Math.max(1, Number(c.same_advisor_window?.value) || 24),
      unit: c.same_advisor_window?.unit === "days" ? "days" : "hours",
    },
  };
}
