/**
 * Tipos compartidos entre ConversacionesClient y sus sub-componentes extraídos.
 * Vivían inline en el archivo monolítico; los movemos acá para evitar
 * dependencias circulares cuando los sub-componentes los necesitan.
 */

export type ChatMessage = {
  id: string;
  from_me: boolean;
  message_type: string;
  content: string | null;
  created_at: string;
  raw_payload?: Record<string, unknown> | null;
};
