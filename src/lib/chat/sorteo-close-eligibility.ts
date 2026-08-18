import "server-only";

import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { SORTEO_COMPROBANTE_ESTADO_VALIDACION_FIELD } from "@/lib/chat/comprobante-validation-types";
import { prepareFlowDataForSorteoOrder, getSorteoIdForChatFlow } from "@/lib/sorteos/sorteo-order-from-chat";
import {
  describeFlowCaptureCompletenessForLogs,
  isParticipantSummaryReviewNode,
  type FlowNodeRowLite,
} from "@/lib/sorteos/sorteo-flow-capture-order";
import { readSorteoCantidadNumericFromMap } from "@/lib/sorteos/sorteo-cantidad-fields";
import { optionPayloadFinalizesSorteoOrder } from "@/lib/sorteos/sorteo-option-payload";
import { isSorteoFinalTicketNode } from "@/lib/chat/sorteo-final-ticket-node";

function norm(s: string | undefined | null): string {
  return (s ?? "").trim();
}

export type ChatFlowConfigJson = {
  /** Si true, no crear orden/cupones hasta confirmación explícita (payload finalize o lazy Confirmado→compra_realizada). */
  close_purchase_only_on_final_confirmation?: boolean;
};

export async function getFlowClosePurchasePolicy(
  supabase: AppSupabaseClient,
  empresaId: string,
  flowCode: string
): Promise<{ closePurchaseOnlyOnFinalConfirmation: boolean }> {
  const fc = flowCode.trim();
  if (!fc) return { closePurchaseOnlyOnFinalConfirmation: false };
  const { data, error } = await supabase
    .from("chat_flows")
    .select("flow_config, updated_at")
    .eq("empresa_id", empresaId)
    .eq("flow_code", fc)
    .order("updated_at", { ascending: false })
    .limit(10);
  if (error || !data?.length) return { closePurchaseOnlyOnFinalConfirmation: false };
  const rawCfg = (data[0] as { flow_config?: unknown }).flow_config;
  const cfg = rawCfg as ChatFlowConfigJson | null | undefined;
  const flag = cfg?.close_purchase_only_on_final_confirmation === true;
  return { closePurchaseOnlyOnFinalConfirmation: flag };
}

export type SorteoCloseReason =
  | "ok"
  | "comprobante_no_valido"
  | "cantidad_faltante"
  | "datos_participante_incompletos"
  | "no_llego_a_confirmacion_final"
  | "flujo_no_es_sorteo";

export type SorteoCloseInteraction =
  | { kind: "explicit_finalize" }
  | {
      kind: "lazy_finalize";
      nextNodeCode: string;
      nextNodeMessageTemplate: string | null;
      selectedLabel: string;
    };

export type CanCloseSorteoPurchaseResult = {
  canClose: boolean;
  reason: SorteoCloseReason;
  hasValidation: boolean;
  hasCantidad: boolean;
  participantComplete: boolean;
  finalConfirmationDetected: boolean;
};

function validationAllowsClose(prep: Record<string, string>): boolean {
  const estVal = norm(prep[SORTEO_COMPROBANTE_ESTADO_VALIDACION_FIELD]);
  if (!estVal) return true;
  return estVal === "valido" || estVal === "aprobado_manual";
}

/**
 * Centraliza reglas para ejecutar finalizeSorteoOrderFromConfirmedFlowData / ensureSorteoOrderFromChat.
 */
export async function canCloseSorteoPurchase(params: {
  supabase: AppSupabaseClient;
  empresaId: string;
  flowCode: string;
  flowData: Record<string, string>;
  /** Traza / compat API; la lógica actual no lo usa. */
  currentNodeCode?: string;
  selectedOption?: {
    label?: string | null;
    option_payload?: unknown;
    next_node_code?: string | null;
  } | null;
  closePurchaseOnlyOnFinalConfirmation: boolean;
  interaction: SorteoCloseInteraction;
}): Promise<CanCloseSorteoPurchaseResult> {
  const prep = prepareFlowDataForSorteoOrder({ ...params.flowData });
  const sorteoId = await getSorteoIdForChatFlow(params.supabase, params.empresaId, params.flowCode);
  if (!sorteoId) {
    return {
      canClose: false,
      reason: "flujo_no_es_sorteo",
      hasValidation: validationAllowsClose(prep),
      hasCantidad: readSorteoCantidadNumericFromMap(prep) != null,
      participantComplete: false,
      finalConfirmationDetected: false,
    };
  }

  const hasValidation = validationAllowsClose(prep);
  const hasCantidad = readSorteoCantidadNumericFromMap(prep) != null;

  if (!hasValidation) {
    return {
      canClose: false,
      reason: "comprobante_no_valido",
      hasValidation: false,
      hasCantidad,
      participantComplete: false,
      finalConfirmationDetected: false,
    };
  }

  const completeness = await describeFlowCaptureCompletenessForLogs(
    params.supabase,
    params.empresaId,
    params.flowCode,
    prep
  );
  const firstInc = completeness?.firstIncomplete;
  const participantComplete = !firstInc;
  const missing = completeness?.missing_fields ?? [];

  if (!participantComplete) {
    const reason: SorteoCloseReason = missing.includes("cantidad")
      ? "cantidad_faltante"
      : "datos_participante_incompletos";
    return {
      canClose: false,
      reason,
      hasValidation: true,
      hasCantidad,
      participantComplete: false,
      finalConfirmationDetected: false,
    };
  }

  let finalConfirmationDetected = true;
  if (params.closePurchaseOnlyOnFinalConfirmation) {
    if (params.interaction.kind === "explicit_finalize") {
      finalConfirmationDetected = optionPayloadFinalizesSorteoOrder(
        params.selectedOption?.option_payload
      );
    } else {
      finalConfirmationDetected = detectLazyFinalizeAllowedSorteoClose({
        selectedLabel: params.interaction.selectedLabel,
        nextNodeCode: params.interaction.nextNodeCode,
        nextNodeMessageTemplate: params.interaction.nextNodeMessageTemplate,
      });
    }
    if (!finalConfirmationDetected) {
      return {
        canClose: false,
        reason: "no_llego_a_confirmacion_final",
        hasValidation: true,
        hasCantidad,
        participantComplete: true,
        finalConfirmationDetected: false,
      };
    }
  }

  return {
    canClose: true,
    reason: "ok",
    hasValidation: true,
    hasCantidad,
    participantComplete: true,
    finalConfirmationDetected,
  };
}

/**
 * Lazy finalize: botón sin payload finalize pero que lleva a nodo final (p. ej. "Confirmado" → compra_realizada).
 */
export function detectLazyFinalizeAllowedSorteoClose(params: {
  selectedLabel: string;
  nextNodeCode: string;
  nextNodeMessageTemplate: string | null;
}): boolean {
  const lbl = norm(params.selectedLabel).toLowerCase();
  const confirmHint =
    /\bconfirmad\b/.test(lbl) ||
    /\bconfirmá\b/.test(lbl) ||
    /\bconfirmar\b/.test(lbl) ||
    /^listo\b/.test(lbl) ||
    /\bacepto\b/.test(lbl);
  const isFinalTarget = isSorteoFinalTicketNode(params.nextNodeCode, {
    nodeMessageTemplate: params.nextNodeMessageTemplate,
  });
  return Boolean(confirmHint && isFinalTarget);
}

/** Nodo de resumen/revisión antes del cierre (para reanudar tras aprobación manual solo-validación). */
export async function findSorteoConfirmationReviewNodeCode(
  supabase: AppSupabaseClient,
  empresaId: string,
  flowCode: string
): Promise<string | null> {
  const fc = flowCode.trim();
  if (!fc) return null;
  const { data: nodesRaw, error } = await supabase
    .from("chat_flow_nodes")
    .select("id, node_code, node_type, message_text, save_as_field, next_node_code, sort_order")
    .eq("empresa_id", empresaId)
    .eq("flow_code", fc)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error || !nodesRaw?.length) return null;
  for (const n of nodesRaw as FlowNodeRowLite[]) {
    if (isParticipantSummaryReviewNode(n)) return norm(n.node_code);
  }
  return null;
}
