/**
 * Logger condicional para diagnóstico del inbox/chat-list.
 *
 * Por defecto NO emite logs en producción: con polling cada pocos segundos y N usuarios
 * concurrentes, los `console.info` saturaban los logs de Hostinger (~5k líneas/min).
 *
 * Activación en runtime SIN redeploy:
 *  - Servidor (API routes / RSC): variable de entorno `DEBUG_CHAT_LIST=1`
 *
 * Los `console.warn` / `console.error` originales se mantienen intactos: este helper solo
 * reemplaza los `console.info` informativos (clasificación, fetch-start, scope, filtros, etc.).
 */
function isDebugEnabled(): boolean {
  if (typeof process !== "undefined" && process.env?.DEBUG_CHAT_LIST === "1") {
    return true;
  }
  return false;
}

export function debugChatList(tag: string, payload: unknown): void {
  if (!isDebugEnabled()) return;
  console.info(tag, payload);
}
