/** Valores persistidos en `chat_conversations.assignment_wait_code` (asignación automática). */
export type AssignmentWaitCode = "manual_queue" | "no_eligible_agent";

export function isAssignmentWaitCode(v: string | null | undefined): v is AssignmentWaitCode {
  return v === "manual_queue" || v === "no_eligible_agent";
}

/** Texto corto para badges en lista / monitoreo (sin agente asignado). */
export function assignmentWaitBadge(
  code: string | null | undefined,
  hasQueue: boolean
): { label: string; tone: "amber" | "slate" | "indigo" } {
  if (isAssignmentWaitCode(code)) {
    if (code === "no_eligible_agent") {
      return { label: "Sin agentes listos", tone: "amber" };
    }
    return { label: "Asignación manual", tone: "indigo" };
  }
  if (hasQueue) {
    return { label: "En cola", tone: "slate" };
  }
  return { label: "Sin cola", tone: "slate" };
}

export function assignmentWaitBadgeClass(tone: "amber" | "slate" | "indigo"): string {
  if (tone === "amber") return "text-amber-900 bg-amber-50 border-amber-200";
  if (tone === "indigo") return "text-indigo-900 bg-indigo-50 border-indigo-200";
  return "text-slate-700 bg-slate-50 border-slate-200";
}
