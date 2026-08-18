"use client";

import { useCallback, useEffect, useState } from "react";
import { ConfigCollapsibleSection } from "@/components/chat/ConfigCollapsibleSection";
import { ChannelQuickRepliesEditor } from "@/components/chat/ChannelQuickRepliesEditor";
import { patchChatChannelQuickRepliesSectionState, type ChatChannelRow } from "@/lib/chat/actions";
import { parseFormSectionStateFromChannelConfig } from "@/lib/chat/channel-form-section-state";

/**
 * Misma UX que WhatsAppChannelForm pero para canales sin formulario grande:
 * estado en `config.form_section_state.quick_replies` + `quick_replies_inbox_enabled`.
 */
export function ChannelQuickRepliesStandaloneBlock({
  channelId,
  channelRow,
  onPersisted,
}: {
  channelId: string;
  channelRow: ChatChannelRow;
  onPersisted: () => void;
}) {
  const [slice, setSlice] = useState(() =>
    parseFormSectionStateFromChannelConfig(channelRow.config).quick_replies
  );
  const [persistError, setPersistError] = useState<string | null>(null);

  const syncFromRow = useCallback(() => {
    setSlice(parseFormSectionStateFromChannelConfig(channelRow.config).quick_replies);
  }, [channelRow.config]);

  useEffect(() => {
    syncFromRow();
  }, [syncFromRow, channelRow.updated_at]);

  async function persist(next: { active: boolean; expanded: boolean }) {
    setPersistError(null);
    const prev = slice;
    setSlice(next);
    try {
      await patchChatChannelQuickRepliesSectionState(channelId, next);
      onPersisted();
    } catch (e) {
      setPersistError(e instanceof Error ? e.message : "No se pudo guardar.");
      setSlice(prev);
    }
  }

  return (
    <div className="space-y-2">
      {persistError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{persistError}</div>
      ) : null}
      <ConfigCollapsibleSection
        title="Respuestas rápidas (inbox)"
        description="Plantillas reutilizables que los asesores insertan desde Conversaciones con el ícono de rayo."
        active={slice.active}
        expanded={slice.expanded}
        hideBodyWhenInactive
        onActiveChange={(v) =>
          persist(v ? { active: true, expanded: slice.expanded } : { active: false, expanded: false })
        }
        onExpandedChange={(v) => {
          if (!slice.active) return;
          persist({ ...slice, expanded: v });
        }}
      >
        {slice.active && slice.expanded ? (
          <ChannelQuickRepliesEditor channelId={channelId} hideIntro />
        ) : null}
      </ConfigCollapsibleSection>
    </div>
  );
}
