"use client";

import { memo } from "react";
import { Flame, UserRound } from "lucide-react";
import type { InboxConversation } from "@/lib/chat/actions";
import { LiveElapsedLabel } from "./LiveElapsedLabel";
import { inboxClientWaitingSince } from "./utils";

/**
 * Badges de turno en la lista de conversaciones:
 *  - Si el cliente escribió y falta respuesta del agente: badge naranja con flamita.
 *  - Si el agente respondió y se espera al cliente: badge celeste con icono persona.
 *
 * Extraído de ConversacionesClient.tsx + envuelto en memo() para que cambios
 * en el padre que no afectan esta fila NO re-rendericen este badge (que tiene
 * un LiveElapsedLabel adentro con su propio setInterval).
 *
 * `dense` aplica tamaños más chicos para densidades altas (sidebar mobile).
 */

type Props = { c: InboxConversation; dense?: boolean };

function InboxReplyTurnBadgesInner({ c, dense }: Props) {
  const agentSince = c.awaiting_agent_reply_since;
  const clientSince = inboxClientWaitingSince(c);
  if (!agentSince && !clientSince) return null;
  const pad = dense ? "px-1.5 py-0.5 text-[9px]" : "px-1.5 py-0.5 text-[10px]";
  return (
    <>
      {agentSince ? (
        <span
          className={`inline-flex items-center gap-0.5 font-semibold text-orange-950 bg-orange-50 border border-orange-200 rounded ${pad} shrink-0`}
          title="Cliente escribió; falta respuesta humana del asesor"
        >
          <Flame className={`shrink-0 text-orange-600 ${dense ? "w-3 h-3" : "w-3.5 h-3.5"}`} aria-hidden />
          <LiveElapsedLabel sinceIso={agentSince} />
        </span>
      ) : null}
      {clientSince ? (
        <span
          className={`inline-flex items-center gap-0.5 font-semibold text-sky-950 bg-sky-50 border border-sky-200 rounded ${pad} shrink-0`}
          title="Último mensaje saliente; turno del contacto"
        >
          <UserRound className={`shrink-0 text-sky-600 ${dense ? "w-3 h-3" : "w-3.5 h-3.5"}`} aria-hidden />
          <LiveElapsedLabel sinceIso={clientSince} />
        </span>
      ) : null}
    </>
  );
}

export const InboxReplyTurnBadges = memo(InboxReplyTurnBadgesInner);
