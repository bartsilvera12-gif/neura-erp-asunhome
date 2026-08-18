/** Ventana en la que un ping de inbox cuenta como "sesión en línea" (UTC / timestamptz). */
export const SESSION_ONLINE_WINDOW_MS = 60_000;

/** Intervalo recomendado para heartbeat desde el cliente (mitad del rango 15–30 s pedido). */
export const INBOX_HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Presencia real: último heartbeat reciente.
 * Distinto del flag legacy `chat_agents.is_online` (no se usa para UI ni routing).
 */
export function isAgentSessionOnline(lastAt: string | Date | null | undefined): boolean {
  if (lastAt == null) return false;
  const t = lastAt instanceof Date ? lastAt.getTime() : new Date(lastAt).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t <= SESSION_ONLINE_WINDOW_MS;
}
