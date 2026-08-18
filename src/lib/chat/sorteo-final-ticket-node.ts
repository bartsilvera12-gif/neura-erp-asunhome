/**
 * Criterio MVP: nodo de cierre de sorteo donde conviene enviar el ticket PNG
 * (después del mensaje de texto al comprador, salvo image_only que intenta PNG antes).
 */
const SORTEO_TICKET_FINAL_NODE_CODES = new Set(["compra_realizada"]);

const SORTEO_CLOSURE_TEMPLATE_SNIPPETS = [
  "{{numero_orden}}",
  "{{numeros_cupon_lineas}}",
  "{{sorteo_cupones}}",
];

export function isSorteoFinalTicketNode(
  nodeCode: string | null | undefined,
  context?: {
    flowEndedWithOrderSummary?: boolean;
    nodeMessageTemplate?: string | null;
  }
): boolean {
  if (context?.flowEndedWithOrderSummary) {
    return true;
  }
  const tpl = (context?.nodeMessageTemplate ?? "").trim();
  if (tpl && SORTEO_CLOSURE_TEMPLATE_SNIPPETS.some((s) => tpl.includes(s))) {
    return true;
  }
  const n = (nodeCode ?? "").trim();
  return n.length > 0 && SORTEO_TICKET_FINAL_NODE_CODES.has(n);
}
