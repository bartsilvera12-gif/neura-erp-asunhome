/**
 * Preflight para cerrar orden sorteo: mismos requisitos que parseSorteoParticipantFromFlowData.
 */
import {
  explainParseSorteoParticipantFailure,
  parseSorteoParticipantFromFlowData,
  prepareFlowDataForSorteoOrder,
} from "@/lib/sorteos/sorteo-order-from-chat";

export type ParticipantFieldKind = "cantidad" | "nombre" | "cedula" | "ciudad";

/** Orden típico en flujos sorteo (cantidad → datos personales). */
const MISSING_PRIORITY: ParticipantFieldKind[] = ["cantidad", "nombre", "cedula", "ciudad"];

export function listMissingParticipantFieldKinds(flowData: Record<string, string>): ParticipantFieldKind[] {
  const prep = prepareFlowDataForSorteoOrder({ ...flowData });
  if (parseSorteoParticipantFromFlowData(prep) != null) {
    return [];
  }
  const explain = explainParseSorteoParticipantFailure(prep).toLowerCase();
  const raw = new Set<ParticipantFieldKind>();
  if (explain.includes("cantidad")) raw.add("cantidad");
  if (explain.includes("nombre")) raw.add("nombre");
  if (raw.size === 0) {
    raw.add("cantidad");
    raw.add("nombre");
  }
  return MISSING_PRIORITY.filter((k) => raw.has(k));
}

export function isParticipantDataCompleteForSorteoClose(flowData: Record<string, string>): boolean {
  const prep = prepareFlowDataForSorteoOrder({ ...flowData });
  return parseSorteoParticipantFromFlowData(prep) != null;
}
