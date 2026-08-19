"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import type { ComprobanteValidacionListRow } from "@/lib/chat/comprobante-validation-types";
import {
  approveComprobanteValidacion,
  fetchChatChannels,
  fetchChatConversations,
  fetchComprobanteValidacionesForConversation,
  hasEmpresaActiveChatFlows,
  markConversationRead,
  releaseConversationToBot,
  type ChatInboxAssignmentFilter,
  type ChatChannelRow,
  type ChatInboxFilters,
  type ConversacionesVista,
  type InboxConversation,
} from "@/lib/chat/actions";
import {
  assignConversationToAgent,
  changeConversationQueue,
  changeConversationStatus,
  fetchSupervisorAgentLoads,
  getMyAgentOperationalPresence,
  listChatQueues,
  setMyAgentOperationalPresence,
  touchChatAgentInboxHeartbeat,
  type ChatAgentOperationalStatus,
  type ChatQueueListRow,
  type InboxCabeceraInsignia,
  type SupervisorAgentLoadRow,
} from "@/lib/chat/chat-ops-actions";
import { INBOX_HEARTBEAT_INTERVAL_MS } from "@/lib/chat/agent-presence";
import { listActiveQuickRepliesForChannel } from "@/lib/chat/quick-replies-actions";
import { ArrowLeftRight, Mic, Paperclip, RefreshCw, Square, Zap } from "lucide-react";
import {
  finalizeConversationWithClosure,
  loadFinalizeOptionsForConversation,
  type FinalizeOptionsResult,
} from "@/lib/chat/conversation-finalize-actions";
import {
  getErpAttachmentFilename,
  getMetaInboundDocumentFilename,
  isImageMimeHint,
} from "@/lib/chat/message-erp-display";
import { assignmentWaitBadge, assignmentWaitBadgeClass } from "@/lib/chat/inbox-assignment-labels";
import type { OmnicanalOperatorRole } from "@/lib/chat/omnicanal-supervision-read";
import { playInboxNotificationBeep, readInboxNotificationSoundEnabled } from "@/lib/chat/inbox-notification-preference";
import { createBrowserClientForSchema } from "@/lib/supabase";
import { ChannelBadge } from "@/components/chat/ChannelBadge";

// Helpers puros + sub-componentes presentacionales extraidos a _components/
// Reduce el monolito de 2902 lineas y permite memo() en cada hijo.
import type { ChatMessage } from "./_components/types";
import { ImageLightbox } from "./_components/ImageLightbox";
import { LiveElapsedLabel } from "./_components/LiveElapsedLabel";
import { InboxReplyTurnBadges } from "./_components/InboxReplyTurnBadges";
import {
  badgeEstadoClass,
  chatListUiLog,
  displayFilenameForAttachment,
  formatChannelOptionLabel,
  formatTime,
  inboxClientWaitingSince,
  labelEstado,
  mapRowToMessage,
  omnicanalRoleBadgeClass,
  omnicanalRoleShortLabel,
  opPresenceToggleClass,
  parseInboxFilters,
  parseOutgoingImageMessage,
  resolveAttachmentUrl,
  tabClass,
} from "./_components/utils";

export type ConversacionesClientMode = "inbox" | "historial";

/** Presencia operativa precargada en el servidor (evita parpadeo y fallos solo-cliente). */
export type ConversacionesInitialOperationalPresence =
  | { in_queues: false; status: null; status_changed_at?: null }
  | { in_queues: true; status: ChatAgentOperationalStatus; status_changed_at: string | null };

export function ConversacionesClient({
  mode,
  chatDataSchema,
  agentDisplayName,
  initialOperationalPresence,
  initialCabeceraInsignia = null,
  initialOmnicanalRole = null,
}: {
  mode: ConversacionesClientMode;
  /** Esquema Postgres de tablas chat_* (zentra_erp o `er_…`). */
  chatDataSchema: string;
  /** Nombre visible del agente logueado (resuelto en servidor). */
  agentDisplayName: string;
  /** Si viene del RSC, el toggle de presencia puede mostrarse sin esperar la primera server action. */
  initialOperationalPresence?: ConversacionesInitialOperationalPresence;
  /** Admin/supervisor sin cola (incluye admin ERP por `usuarios.rol`). */
  initialCabeceraInsignia?: InboxCabeceraInsignia;
  /** Rol operativo omnicanal (precargado para mensajes UX de alcance). */
  initialOmnicanalRole?: OmnicanalOperatorRole | null;
}) {
  const supabaseChat = useMemo(
    () => createBrowserClientForSchema(chatDataSchema),
    [chatDataSchema]
  );
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const vistaParam = searchParams?.get("vista") ?? "";
  const vista: ConversacionesVista =
    mode === "historial" ? "historial" : vistaParam === "bot" ? "bot" : "inbox";

  const [conversations, setConversations] = useState<InboxConversation[]>([]);
  const conversationsRef = useRef<InboxConversation[]>([]);
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [loadingMsg, setLoadingMsg] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  /** Grabación de nota de voz (MediaRecorder) antes de subir a /api/chat/send-media. */
  const [recordingVoice, setRecordingVoice] = useState(false);
  const [releasingBot, setReleasingBot] = useState(false);
  const [resendFlowStepLoading, setResendFlowStepLoading] = useState(false);
  const [resendFlowNotice, setResendFlowNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [hasActiveChannel, setHasActiveChannel] = useState<boolean | null>(null);
  /** Canales activos de la empresa (selector de filtro inbox/historial). */
  const [inboxChannels, setInboxChannels] = useState<ChatChannelRow[]>([]);
  const [compVals, setCompVals] = useState<ComprobanteValidacionListRow[]>([]);
  const [compLoading, setCompLoading] = useState(false);
  const [compActionId, setCompActionId] = useState<string | null>(null);
  const [compApproveConfirmId, setCompApproveConfirmId] = useState<string | null>(null);
  const [compApprovalInfo, setCompApprovalInfo] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  // Handler estable para el ImageLightbox memoizado: sin useCallback el padre
  // creaba un closure nuevo en cada render y memo() era inutil.
  const closeLightbox = useCallback(() => setLightboxUrl(null), []);
  const [opsQueues, setOpsQueues] = useState<ChatQueueListRow[]>([]);
  const [opsAgentLoads, setOpsAgentLoads] = useState<SupervisorAgentLoadRow[]>([]);
  const [opsBusy, setOpsBusy] = useState(false);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  /** Cola elegida: transferencia a cola y filtro de agentes en el modal. */
  const [transferQueueTarget, setTransferQueueTarget] = useState("");
  const [transferAgentSearch, setTransferAgentSearch] = useState("");
  const [transferLoadsRefreshing, setTransferLoadsRefreshing] = useState(false);
  const [channelQuickReplies, setChannelQuickReplies] = useState<
    Array<{ id: string; title: string; body: string }>
  >([]);
  const [quickRepliesLoading, setQuickRepliesLoading] = useState(false);
  const [quickReplyOpen, setQuickReplyOpen] = useState(false);
  const [quickReplySearch, setQuickReplySearch] = useState("");
  const quickReplyPanelRef = useRef<HTMLDivElement | null>(null);
  const [hasActiveBotFlows, setHasActiveBotFlows] = useState(false);
  const [botFlowsChecked, setBotFlowsChecked] = useState(false);
  const [compValidacionesOpen, setCompValidacionesOpen] = useState(false);
  const [listColumnHidden, setListColumnHidden] = useState(false);
  /** Filtro local del listado (nombre o teléfono); no altera la carga desde servidor. */
  const [listSearch, setListSearch] = useState("");
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [finalizeLoading, setFinalizeLoading] = useState(false);
  const [opPresenceLoaded, setOpPresenceLoaded] = useState(
    mode !== "inbox" || initialOperationalPresence !== undefined
  );
  const [opInQueues, setOpInQueues] = useState(
    mode !== "inbox" ? false : (initialOperationalPresence?.in_queues ?? false)
  );
  const [opStatus, setOpStatus] = useState<ChatAgentOperationalStatus | null>(
    mode !== "inbox"
      ? null
      : initialOperationalPresence?.in_queues
        ? initialOperationalPresence.status
        : null
  );
  const [opPresenceBusy, setOpPresenceBusy] = useState(false);
  const [opPresenceErr, setOpPresenceErr] = useState<string | null>(null);
  const [opPresenceOkMsg, setOpPresenceOkMsg] = useState<string | null>(null);
  const [opSince, setOpSince] = useState<string | null>(() =>
    mode === "inbox" && initialOperationalPresence?.in_queues
      ? initialOperationalPresence.status_changed_at ?? null
      : null
  );
  /** Ancla de sesión en esta pestaña inbox (tiempo de uso del módulo). */
  const [sessionSinceIso, setSessionSinceIso] = useState<string | null>(null);
  const [finalizeSaving, setFinalizeSaving] = useState(false);
  const [finalizeOptions, setFinalizeOptions] = useState<FinalizeOptionsResult | null>(null);
  const [finalizeStateId, setFinalizeStateId] = useState("");
  const [finalizeSubstateId, setFinalizeSubstateId] = useState("");
  const [finalizeComment, setFinalizeComment] = useState("");
  const [finalizeModalError, setFinalizeModalError] = useState<string | null>(null);

  const inboxFilterKey = searchParams?.toString() ?? "";

  /** Lectura siempre actual para sondeos silenciosos / realtime (evita filtros obsoletos en closure). */
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;

  /** Optimista: `router.replace` actualiza la URL un tick después; sin esto el select vuelve al valor anterior. */
  const [pendingCanal, setPendingCanal] = useState<string | null>(null);
  const [pendingCola, setPendingCola] = useState<string | null>(null);
  const [pendingAsignacion, setPendingAsignacion] = useState<string | null>(null);

  const urlCanal = searchParams?.get("canal")?.trim() ?? "";
  const urlCola = searchParams?.get("cola")?.trim() ?? "";
  const urlAsignacionRaw = searchParams?.get("asignacion")?.trim();
  const urlAsignacion =
    urlAsignacionRaw === "mios" ? "mios" : urlAsignacionRaw === "sin_asignar" ? "sin_asignar" : "";

  const displayCanal = pendingCanal !== null ? pendingCanal : urlCanal;
  const displayCola = pendingCola !== null ? pendingCola : urlCola;
  const displayAsignacion = pendingAsignacion !== null ? pendingAsignacion : urlAsignacion;

  useEffect(() => {
    if (pendingCanal !== null && pendingCanal === urlCanal) setPendingCanal(null);
  }, [pendingCanal, urlCanal]);
  useEffect(() => {
    if (pendingCola !== null && pendingCola === urlCola) setPendingCola(null);
  }, [pendingCola, urlCola]);
  useEffect(() => {
    if (pendingAsignacion !== null && pendingAsignacion === urlAsignacion) setPendingAsignacion(null);
  }, [pendingAsignacion, urlAsignacion]);

  /** Si la URL corrige un canal inválido (p. ej. ya no existe), alinear UI optimista. */
  useEffect(() => {
    if (pendingCanal === null || inboxChannels.length === 0) return;
    if (urlCanal !== "") return;
    const stillValid = inboxChannels.some((c) => c.id === pendingCanal);
    if (!stillValid) setPendingCanal(null);
  }, [pendingCanal, urlCanal, inboxChannels]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedIdRef = useRef<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  /** Si el usuario está cerca del final, los mensajes nuevos hacen scroll; si subió a leer historial, no. */
  const stickBottomRef = useRef(true);
  const lastMessageIdRef = useRef<string | null>(null);
  const loadConversationsRef = useRef<(opts?: { silent?: boolean }) => Promise<void>>(async () => {});
  /** Tras la primera carga visible del inbox, se permite el beep (evita sonido en hidratar inicial). */
  const inboxSoundPrimedRef = useRef(false);
  /** Dedupe de ids de mensaje entrante ya notificados con sonido. */
  const inboundSoundMsgIdsRef = useRef<Set<string>>(new Set());

  /** Evita aplicar respuestas viejas si el usuario cambió de chat rápido. */
  const messagesLoadGenRef = useRef(0);
  /** Cache en memoria por sesión: reabrir conversación muestra historial al instante y refresca después. */
  const messagesSessionCacheRef = useRef<Map<string, ChatMessage[]>>(new Map());

  const loadConversations = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? false;
      const sp = new URLSearchParams(searchParamsRef.current?.toString() ?? "");
      const filters = parseInboxFilters(sp);
      const previousCount = conversationsRef.current.length;
      if (silent) {
        chatListUiLog("refetch-start", {
          activeTab: vista,
          previous_count: previousCount,
          source: "loadConversations",
          reason: "silent",
          filters: filters ?? null,
        });
      }
      try {
        const {
          conversations: rows,
          base_row_count: baseRowCount,
          transient_list_error: transientListError,
        } = await fetchChatConversations(vista, filters);
        if (silent) {
          chatListUiLog("refetch-result", {
            activeTab: vista,
            previous_count: previousCount,
            next_count: rows.length,
            base_row_count: baseRowCount,
            source: "fetchChatConversations",
            reason: "ok",
            filters: filters ?? null,
          });
        }
        const preserveSilentEmpty =
          silent &&
          rows.length === 0 &&
          previousCount > 0 &&
          (baseRowCount === 0 || Boolean(transientListError));
        if (preserveSilentEmpty) {
          chatListUiLog("refetch-preserve", {
            activeTab: vista,
            previous_count: previousCount,
            next_count: 0,
            base_row_count: baseRowCount,
            source: "fetchChatConversations",
            reason: "silent_empty_keeps_previous",
            filters: filters ?? null,
          });
        } else {
          chatListUiLog("set-conversations", {
            activeTab: vista,
            previous_count: previousCount,
            next_count: rows.length,
            base_row_count: baseRowCount,
            source: "fetchChatConversations",
            reason: silent ? "silent_replace" : "load",
            filters: filters ?? null,
          });
          setConversations(rows);
        }
        if (!silent && previousCount === 0) {
          chatListUiLog("initial-data", {
            activeTab: vista,
            previous_count: 0,
            next_count: rows.length,
            base_row_count: baseRowCount,
            source: "first_fetch",
            reason: "hydrated",
            filters: filters ?? null,
          });
        }
        setListError(null);
        if (transientListError && !silent && rows.length === 0) {
          setListError(
            "No pudimos refrescar el listado (base de datos ocupada). La vista anterior se mantiene si ya tenías datos."
          );
        }
      } catch (e) {
        chatListUiLog("refetch-result", {
          activeTab: vista,
          previous_count: previousCount,
          source: "fetchChatConversations",
          reason: "error",
          error: e instanceof Error ? e.message : String(e),
          filters: filters ?? null,
        });
        setListError(e instanceof Error ? e.message : "Error al cargar conversaciones");
      } finally {
        if (!silent) {
          setLoadingList(false);
          inboxSoundPrimedRef.current = true;
        }
      }
    },
    [vista]
  );

  const loadMessages = useCallback(async (conversationId: string, opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    const ticket = silent ? -1 : ++messagesLoadGenRef.current;

    if (!silent) {
      setMessagesError(null);
      const cached = messagesSessionCacheRef.current.get(conversationId);
      if (cached && cached.length > 0) {
        setMessages(cached);
        setLoadingMsg(false);
      } else {
        setMessages([]);
        setLoadingMsg(true);
      }
    } else {
      setMessagesError(null);
    }

    try {
      const qs = new URLSearchParams({ conversation_id: conversationId });
      const res = await fetchWithSupabaseSession(`/api/chat/messages?${qs.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        let detail = "";
        try {
          const j = (await res.json()) as { error?: string; message?: string };
          detail = (j.error || j.message || "").trim();
        } catch {
          detail = (await res.text().catch(() => "")).trim();
        }
        throw new Error(detail || `Error ${res.status} al cargar mensajes`);
      }
      const json = (await res.json()) as { success?: boolean; data?: Record<string, unknown>[] };
      if (!json.success || !Array.isArray(json.data)) {
        if (
          !silent &&
          ticket === messagesLoadGenRef.current &&
          selectedIdRef.current === conversationId
        ) {
          setMessages([]);
          messagesSessionCacheRef.current.delete(conversationId);
        }
        return;
      }
      const mapped = json.data.map(mapRowToMessage);
      messagesSessionCacheRef.current.set(conversationId, mapped);

      if (silent) {
        if (selectedIdRef.current !== conversationId) return;
        setMessages(mapped);
        return;
      }

      if (ticket !== messagesLoadGenRef.current || selectedIdRef.current !== conversationId) {
        return;
      }
      setMessages(mapped);
    } catch (e) {
      if (silent) return;
      if (ticket !== messagesLoadGenRef.current) return;
      if (selectedIdRef.current !== conversationId) return;
      const cachedFallback = messagesSessionCacheRef.current.get(conversationId);
      if (!cachedFallback?.length) {
        setMessages([]);
      }
      setMessagesError(e instanceof Error ? e.message : "Error al cargar mensajes");
    } finally {
      if (!silent && ticket === messagesLoadGenRef.current && selectedIdRef.current === conversationId) {
        setLoadingMsg(false);
      }
    }
  }, []);

  const loadMessagesRef = useRef(loadMessages);
  loadMessagesRef.current = loadMessages;

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const sendMediaFile = useCallback(async (file: File) => {
    const cid = selectedIdRef.current;
    if (!cid || file.size < 1) return;
    setSendError(null);
    stickBottomRef.current = true;
    setUploadingFile(true);
    try {
      const fd = new FormData();
      fd.set("conversation_id", cid);
      fd.set("file", file);
      const res = await fetchWithSupabaseSession("/api/chat/send-media", {
        method: "POST",
        body: fd,
        credentials: "same-origin",
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        throw new Error(typeof json.error === "string" ? json.error : `Error HTTP ${res.status}`);
      }
      await loadMessagesRef.current(cid, { silent: true });
      await loadConversationsRef.current?.({ silent: true });
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Error al enviar archivo");
    } finally {
      setUploadingFile(false);
    }
  }, []);

  async function toggleVoiceNote() {
    const cid = selectedIdRef.current;
    if (!cid || uploadingFile) return;
    const mr = mediaRecorderRef.current;
    if (mr && mr.state === "recording") {
      mr.stop();
      return;
    }
    setSendError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      recordChunksRef.current = [];
      const mime =
        typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("audio/webm")
            ? "audio/webm"
            : "";
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      mediaRecorderRef.current = rec;
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) recordChunksRef.current.push(ev.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        mediaRecorderRef.current = null;
        streamRef.current = null;
        const blob = new Blob(recordChunksRef.current, { type: rec.mimeType || "audio/webm" });
        recordChunksRef.current = [];
        setRecordingVoice(false);
        if (blob.size < 300) return;
        const ext = blob.type.includes("ogg") ? "ogg" : "webm";
        const voiceFile = new File([blob], `nota-voz.${ext}`, { type: blob.type || "audio/webm" });
        void sendMediaFile(voiceFile);
      };
      setRecordingVoice(true);
      rec.start(400);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "No se pudo acceder al micrófono");
      setRecordingVoice(false);
    }
  }

  useEffect(() => {
    return () => {
      try {
        mediaRecorderRef.current?.stop();
      } catch {
        /* noop */
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  loadConversationsRef.current = loadConversations;

  useEffect(() => {
    setSelectedId(null);
    setMessages([]);
  }, [vista]);

  useEffect(() => {
    setLoadingList(true);
    void loadConversations();
  }, [loadConversations, inboxFilterKey]);

  useEffect(() => {
    // cancelled flag: si la pagina de conversaciones se desmonta (user navega a otro
    // modulo) antes de que estos dos RPCs respondan, evitamos setState-after-unmount.
    // No usamos AbortController porque los wrappers (listChatQueues, fetchSupervisorAgentLoads)
    // no aceptan signal — son llamadas via cliente Supabase, no fetch directo.
    let cancelled = false;
    listChatQueues()
      .then((v) => { if (!cancelled) setOpsQueues(v); })
      .catch(() => { if (!cancelled) setOpsQueues([]); });
    fetchSupervisorAgentLoads()
      .then((v) => { if (!cancelled) setOpsAgentLoads(v); })
      .catch(() => { if (!cancelled) setOpsAgentLoads([]); });
    return () => { cancelled = true; };
  }, []);

  const patchInboxQuery = useCallback(
    (patch: Record<string, string | null | undefined>) => {
      const next = new URLSearchParams(searchParams?.toString() ?? "");
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined || v === "") next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      const basePath =
        pathname ??
        (mode === "historial" ? "/dashboard/historial-omnicanal" : "/dashboard/conversaciones");
      router.replace(qs ? `${basePath}?${qs}` : basePath);
    },
    [searchParams, router, pathname, mode]
  );

  useEffect(() => {
    const cola = searchParams?.get("cola")?.trim() ?? "";
    if (!cola || opsQueues.length === 0) return;
    const ok = opsQueues.some((q) => q.id === cola);
    if (!ok) patchInboxQuery({ cola: null });
  }, [opsQueues, searchParams, patchInboxQuery]);

  useEffect(() => {
    const canal = searchParams?.get("canal")?.trim() ?? "";
    if (!canal || inboxChannels.length === 0) return;
    const ok = inboxChannels.some((c) => c.id === canal);
    if (!ok) patchInboxQuery({ canal: null });
  }, [inboxChannels, searchParams, patchInboxQuery]);

  useEffect(() => {
    if (!transferModalOpen) return;
    let cancelled = false;
    setTransferLoadsRefreshing(true);
    void fetchSupervisorAgentLoads()
      .then((rows) => {
        if (!cancelled) setOpsAgentLoads(rows);
      })
      .catch(() => {
        if (!cancelled) setOpsAgentLoads([]);
      })
      .finally(() => {
        if (!cancelled) setTransferLoadsRefreshing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [transferModalOpen]);

  const filteredTransferAgents = useMemo(() => {
    const q = transferAgentSearch.trim().toLowerCase();
    const rows = opsAgentLoads.filter((a) =>
      transferQueueTarget === "" ? true : a.queue_id === transferQueueTarget
    );
    if (!q) return rows;
    return rows.filter(
      (a) =>
        a.nombre.toLowerCase().includes(q) ||
        (a.email && a.email.toLowerCase().includes(q)) ||
        a.queue_nombre.toLowerCase().includes(q)
    );
  }, [opsAgentLoads, transferAgentSearch, transferQueueTarget]);

  function setVista(next: ConversacionesVista) {
    if (mode === "historial") {
      if (next === "inbox") router.push("/dashboard/conversaciones");
      if (next === "bot" && hasActiveBotFlows) router.push("/dashboard/conversaciones?vista=bot");
      return;
    }
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (next === "inbox") params.delete("vista");
    else if (next === "bot" && hasActiveBotFlows) params.set("vista", "bot");
    else if (next === "historial") {
      router.push("/dashboard/historial-omnicanal");
      return;
    }
    const qs = params.toString();
    const base = "/dashboard/conversaciones";
    router.push(qs ? `${base}?${qs}` : base);
  }

  useEffect(() => {
    // Mismo patron: cancelled flag para evitar setState tras unmount.
    let cancelled = false;
    fetchChatChannels()
      .then((ch) => {
        if (cancelled) return;
        setHasActiveChannel(ch.some((c) => c.activo));
        setInboxChannels(ch.filter((c) => c.activo));
      })
      .catch(() => {
        if (cancelled) return;
        setHasActiveChannel(null);
        setInboxChannels([]);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (mode !== "inbox") {
      setBotFlowsChecked(true);
      return;
    }
    // cancelled flag: si el modo cambia o el componente se desmonta antes
    // de que termine el RPC, no actualizamos state obsoleto.
    let cancelled = false;
    void hasEmpresaActiveChatFlows().then((v) => {
      if (cancelled) return;
      setHasActiveBotFlows(v);
      setBotFlowsChecked(true);
    });
    return () => { cancelled = true; };
  }, [mode]);

  useEffect(() => {
    if (mode !== "inbox") {
      setOpPresenceLoaded(true);
      setOpInQueues(false);
      setOpStatus(null);
      setOpPresenceErr(null);
      return;
    }
    let cancelled = false;
    if (initialOperationalPresence === undefined) {
      setOpPresenceLoaded(false);
    }
    setOpPresenceErr(null);
    void getMyAgentOperationalPresence()
      .then((p) => {
        if (cancelled) return;
        if (p.in_queues) {
          setOpInQueues(true);
          setOpStatus(p.status);
          setOpSince(p.status_changed_at);
        } else {
          setOpInQueues(false);
          setOpStatus(null);
          setOpSince(null);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        if (initialOperationalPresence === undefined) {
          setOpInQueues(false);
          setOpStatus(null);
          setOpSince(null);
        }
        setOpPresenceErr(e instanceof Error ? e.message : "No se pudo cargar estado operativo");
      })
      .finally(() => {
        if (!cancelled) setOpPresenceLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, initialOperationalPresence]);

  useEffect(() => {
    if (mode !== "inbox") return;
    setSessionSinceIso((prev) => prev ?? new Date().toISOString());
  }, [mode]);

  useEffect(() => {
    if (mode !== "inbox" || !opInQueues) return;
    void touchChatAgentInboxHeartbeat();
    // Guard de visibility para no spamear el endpoint con la pestana oculta.
    // El handler onVis de mas abajo dispara un heartbeat al volver, asi que no perdemos presencia.
    const id = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void touchChatAgentInboxHeartbeat();
    }, INBOX_HEARTBEAT_INTERVAL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") void touchChatAgentInboxHeartbeat();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [mode, opInQueues]);

  const applyOperationalStatus = useCallback(async (next: ChatAgentOperationalStatus) => {
    setOpPresenceErr(null);
    setOpPresenceOkMsg(null);
    setOpPresenceBusy(true);
    try {
      const res = await setMyAgentOperationalPresence(next);
      if (!res.applied) {
        if (res.reason === "missing_operational_status_column") {
          setOpPresenceErr(
            "Presencia no disponible en base de datos (falta columna). Ejecutá la migración operational_status en Supabase o contactá soporte."
          );
        } else {
          setOpPresenceErr(res.reason?.trim() || "No se pudo guardar el estado.");
        }
        return;
      }
      const refreshed = await getMyAgentOperationalPresence();
      if (refreshed.in_queues) {
        setOpInQueues(true);
        setOpStatus(refreshed.status);
        setOpSince(refreshed.status_changed_at ?? new Date().toISOString());
      } else {
        setOpInQueues(false);
        setOpStatus(null);
        setOpSince(null);
      }
      setOpPresenceOkMsg(next === "ready" ? "Disponible · guardado" : "En pausa · guardado");
      window.setTimeout(() => setOpPresenceOkMsg(null), 3500);
    } catch (e) {
      setOpPresenceErr(e instanceof Error ? e.message : "No se pudo guardar el estado");
    } finally {
      setOpPresenceBusy(false);
    }
  }, []);

  /** URL legacy: ?vista=historial en inbox → ruta dedicada */
  useEffect(() => {
    if (mode !== "inbox") return;
    if (searchParams?.get("vista") === "historial") {
      router.replace("/dashboard/historial-omnicanal");
    }
  }, [mode, router, searchParams]);

  /** Sin flujos activos, no forzar vista bot */
  useEffect(() => {
    if (mode !== "inbox" || !botFlowsChecked || hasActiveBotFlows) return;
    if (searchParams?.get("vista") !== "bot") return;
    router.replace("/dashboard/conversaciones");
  }, [mode, botFlowsChecked, hasActiveBotFlows, router, searchParams]);

  /** Lista: Realtime sobre conversaciones + INSERT en mensajes (cubre preview/unread si el UPDATE de conversación no emite). */
  useEffect(() => {
    const channel = supabaseChat
      .channel("conversaciones-inbox-list")
      .on(
        "postgres_changes",
        { event: "*", schema: chatDataSchema, table: "chat_conversations" },
        () => {
          void loadConversationsRef.current?.({ silent: true });
        }
      )
      .subscribe();

    return () => {
      void supabaseChat.removeChannel(channel);
    };
  }, [chatDataSchema, supabaseChat]);

  /** Mensajes entrantes: refresca inbox, beep opcional (dedupe por id de mensaje). */
  useEffect(() => {
    const channel = supabaseChat
      .channel("conversaciones-inbox-inbound-messages")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: chatDataSchema, table: "chat_messages" },
        (payload) => {
          void loadConversationsRef.current?.({ silent: true });
          const row = payload.new as Record<string, unknown>;
          const convId = typeof row?.conversation_id === "string" ? row.conversation_id : "";
          if (convId && convId === selectedIdRef.current) {
            void loadMessagesRef.current(convId, { silent: true });
          }
          const mid = typeof row?.id === "string" ? row.id : "";
          if (!mid || row.from_me === true) return;
          if (inboundSoundMsgIdsRef.current.has(mid)) return;
          inboundSoundMsgIdsRef.current.add(mid);
          if (inboundSoundMsgIdsRef.current.size > 600) {
            inboundSoundMsgIdsRef.current.clear();
          }
          if (!inboxSoundPrimedRef.current) return;
          if (readInboxNotificationSoundEnabled()) {
            playInboxNotificationBeep();
          }
        }
      )
      .subscribe();

    return () => {
      void supabaseChat.removeChannel(channel);
    };
  }, [chatDataSchema, supabaseChat]);

  /** Respaldo si Realtime no llega (publicación RLS, pestaña en background, etc.).
   *  Frecuencia configurable en runtime sin redeploy:
   *    localStorage.setItem("__neura_inbox_poll_ms__", "2800")  // volver al valor original
   *    localStorage.removeItem("__neura_inbox_poll_ms__")        // usar default
   *  Default 5000 ms: Realtime ya cubre los eventos en <1s; este intervalo es solo respaldo. */
  useEffect(() => {
    const override =
      typeof window !== "undefined"
        ? Number(window.localStorage?.getItem("__neura_inbox_poll_ms__") ?? "")
        : NaN;
    const intervalMs = Number.isFinite(override) && override >= 1000 ? override : 5000;
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadConversationsRef.current?.({ silent: true });
    }, intervalMs);
    return () => window.clearInterval(id);
  }, []);

  /** Al volver a la pestaña, sincronizar de inmediato (evita depender solo del intervalo). */
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      void loadConversationsRef.current?.({ silent: true });
      const sid = selectedIdRef.current;
      if (sid) void loadMessagesRef.current(sid, { silent: true });
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  /** Con hilo abierto: sondeo corto por si Realtime no entrega INSERT/UPDATE (p. ej. webhook vía PG).
   *  Override en runtime:
   *    localStorage.setItem("__neura_thread_poll_ms__", "2800")  // volver al valor original
   *  Default 5000 ms: Realtime + Realtime con filtro `conversation_id=eq.${selectedId}` cubren el caso normal. */
  useEffect(() => {
    if (!selectedId) return;
    const override =
      typeof window !== "undefined"
        ? Number(window.localStorage?.getItem("__neura_thread_poll_ms__") ?? "")
        : NaN;
    const intervalMs = Number.isFinite(override) && override >= 1000 ? override : 5000;
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadMessagesRef.current(selectedId, { silent: true });
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [selectedId]);

  /** Mensajes del hilo abierto: INSERT/UPDATE en tiempo real (UPDATE cubre enrich de media YCloud). */
  useEffect(() => {
    if (!selectedId) return;

    const mergeRow = (row: Record<string, unknown>) => {
      if (!row?.id) return;
      const msg = mapRowToMessage(row);
      setMessages((prev) => {
        const i = prev.findIndex((m) => m.id === msg.id);
        let next: ChatMessage[];
        if (i >= 0) {
          next = [...prev];
          next[i] = msg;
        } else {
          next = [...prev, msg].sort(
            (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
        }
        messagesSessionCacheRef.current.set(selectedId, next);
        return next;
      });
    };

    const channel = supabaseChat
      .channel(`conversaciones-msg-${selectedId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: chatDataSchema,
          table: "chat_messages",
          filter: `conversation_id=eq.${selectedId}`,
        },
        (payload) => mergeRow(payload.new as Record<string, unknown>)
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: chatDataSchema,
          table: "chat_messages",
          filter: `conversation_id=eq.${selectedId}`,
        },
        (payload) => mergeRow(payload.new as Record<string, unknown>)
      )
      .subscribe();

    return () => {
      void supabaseChat.removeChannel(channel);
    };
  }, [selectedId, chatDataSchema, supabaseChat]);

  const onMessagesScroll = useCallback(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    const threshold = 100;
    stickBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }, []);

  useLayoutEffect(() => {
    if (!selectedId || messages.length === 0) return;
    const last = messages[messages.length - 1]?.id;
    const prev = lastMessageIdRef.current;
    lastMessageIdRef.current = last;

    if (last === prev) return;

    const el = messagesScrollRef.current;
    if (!el) return;
    if (!stickBottomRef.current && prev !== null) return;

    el.scrollTop = el.scrollHeight;
  }, [messages, selectedId]);

  const handleSelect = useCallback(
    async (id: string) => {
      stickBottomRef.current = true;
      lastMessageIdRef.current = null;
      setMessagesError(null);
      setSelectedId(id);
      await loadMessages(id);
      const compOn = conversations.some(
        (c) => c.id === id && c.channel.comprobante_validation_enabled === true
      );
      if (compOn) {
        setCompLoading(true);
        try {
          const rows = await fetchComprobanteValidacionesForConversation(id);
          setCompVals(rows);
        } catch {
          setCompVals([]);
        } finally {
          setCompLoading(false);
        }
      } else {
        setCompVals([]);
        setCompLoading(false);
      }
      try {
        await markConversationRead(id);
        setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, unread_count: 0 } : c)));
      } catch {
        /* no bloquear UI */
      }
    },
    [loadMessages, conversations]
  );

  async function handleSendFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !selectedId || uploadingFile) return;
    await sendMediaFile(file);
  }

  async function handleReleaseToBot() {
    if (!selectedId || releasingBot) return;
    setReleasingBot(true);
    setSendError(null);
    try {
      await releaseConversationToBot(selectedId);
      await loadConversations({ silent: true });
      if (vista === "inbox") {
        setSelectedId(null);
        setMessages([]);
      }
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "No se pudo devolver al bot");
    } finally {
      setReleasingBot(false);
    }
  }

  useEffect(() => {
    if (!resendFlowNotice) return;
    const t = window.setTimeout(() => setResendFlowNotice(null), 5000);
    return () => window.clearTimeout(t);
  }, [resendFlowNotice]);

  async function handleResendCurrentFlowStep() {
    if (!selectedId || resendFlowStepLoading) return;
    const sel = conversationsRef.current.find((c) => c.id === selectedId);
    if (!sel?.flow_code?.trim() || !sel?.flow_current_node?.trim() || sel.status === "closed") return;

    let confirmHumanOverride = false;
    if (sel.human_taken_over || sel.flow_status === "human") {
      const ok = window.confirm(
        "La conversación está en modo humano. ¿Reenviar igualmente el mensaje del paso actual del bot?"
      );
      if (!ok) return;
      confirmHumanOverride = true;
    }

    const postOnce = async (override: boolean) => {
      const res = await fetchWithSupabaseSession(
        `/api/chat/conversations/${encodeURIComponent(selectedId)}/resend-current-node`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm_human_override: override }),
        }
      );
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        needs_human_override_confirmation?: boolean;
      };
      return { res, json };
    };

    setResendFlowStepLoading(true);
    setResendFlowNotice(null);
    setSendError(null);
    try {
      let { res, json } = await postOnce(confirmHumanOverride);
      if (res.status === 409 && json.needs_human_override_confirmation) {
        const ok = window.confirm(
          "La conversación está en modo humano. ¿Reenviar igualmente el mensaje del paso actual del bot?"
        );
        if (!ok) return;
        ({ res, json } = await postOnce(true));
      }
      if (!res.ok || !json.ok) {
        const errMsg =
          typeof json.error === "string" && json.error.trim()
            ? json.error.trim()
            : "No se pudo reenviar el paso actual. Revisá el estado del canal o los logs.";
        setResendFlowNotice({ kind: "err", text: errMsg });
        return;
      }
      setResendFlowNotice({ kind: "ok", text: "Paso actual reenviado correctamente." });
      await loadMessages(selectedId, { silent: true });
      await loadConversations({ silent: true });
    } catch {
      setResendFlowNotice({
        kind: "err",
        text: "No se pudo reenviar el paso actual. Revisá el estado del canal o los logs.",
      });
    } finally {
      setResendFlowStepLoading(false);
    }
  }

  async function runConversationOp(fn: () => Promise<void>) {
    if (!selectedId || opsBusy) return;
    setOpsBusy(true);
    setSendError(null);
    try {
      await fn();
      await loadConversations({ silent: true });
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Error en la acción");
    } finally {
      setOpsBusy(false);
    }
  }

  async function openFinalizeModal() {
    const sel = selectedId ? conversations.find((c) => c.id === selectedId) : null;
    if (!selectedId || !sel || sel.status === "closed") return;
    setFinalizeModalError(null);
    setFinalizeOpen(true);
    setFinalizeLoading(true);
    setFinalizeOptions(null);
    setFinalizeStateId("");
    setFinalizeSubstateId("");
    setFinalizeComment("");
    try {
      const opts = await loadFinalizeOptionsForConversation(selectedId);
      setFinalizeOptions(opts);
      const first = opts.states[0];
      if (first) {
        setFinalizeStateId(first.id);
        setFinalizeSubstateId(first.substates[0]?.id ?? "");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "No se pudieron cargar las opciones de cierre";
      setFinalizeModalError(msg);
      if (msg.includes("finalizada")) {
        setFinalizeOpen(false);
      }
    } finally {
      setFinalizeLoading(false);
    }
  }

  function closeFinalizeModal() {
    if (finalizeSaving) return;
    setFinalizeOpen(false);
    setFinalizeModalError(null);
  }

  async function confirmFinalize() {
    if (!selectedId || !finalizeOptions) return;
    setFinalizeModalError(null);
    const st = finalizeOptions.states.find((x) => x.id === finalizeStateId);
    if (!st) {
      setFinalizeModalError("Elegí un estado.");
      return;
    }
    if (st.substates.length > 0 && !finalizeSubstateId) {
      setFinalizeModalError("Elegí un subestado.");
      return;
    }
    const comment = finalizeComment.trim();
    if (comment.length < 3) {
      setFinalizeModalError("El comentario es obligatorio (al menos 3 caracteres).");
      return;
    }
    const sub = st.substates.find((x) => x.id === finalizeSubstateId);
    setFinalizeSaving(true);
    try {
      await finalizeConversationWithClosure({
        conversationId: selectedId,
        closureStateId: st.id,
        closureSubstateId: st.substates.length > 0 ? finalizeSubstateId : null,
        closureStateLabel: st.label,
        closureSubstateLabel: sub?.label ?? (st.substates.length > 0 ? "" : "—"),
        comment,
      });
      setFinalizeOpen(false);
      setFinalizeOptions(null);
      if (mode === "inbox") {
        setSelectedId(null);
        setMessages([]);
      }
      await loadConversations({ silent: true });
    } catch (e) {
      setFinalizeModalError(e instanceof Error ? e.message : "No se pudo finalizar la conversación");
    } finally {
      setFinalizeSaving(false);
    }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !input.trim() || sending) return;
    setSending(true);
    setSendError(null);
    stickBottomRef.current = true;
    try {
      const res = await fetchWithSupabaseSession("/api/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ conversation_id: selectedId, message: input.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        meta?: unknown;
      };
      if (!res.ok) {
        const base =
          typeof json.error === "string"
            ? json.error
            : res.status === 401
              ? "Sesión expirada o no autenticado"
              : `Error al enviar (HTTP ${res.status})`;
        throw new Error(base);
      }
      setInput("");
      setSendError(null);
      await loadMessages(selectedId, { silent: true });
      await loadConversations({ silent: true });
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Error al enviar");
    } finally {
      setSending(false);
    }
  }

  const visibleConversations = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    if (!q) return conversations;
    const qDigits = q.replace(/\D/g, "");
    return conversations.filter((c) => {
      const name = (c.contact.name || "").toLowerCase();
      const phone = String(c.contact.phone_number || "");
      const phoneDigits = phone.replace(/\D/g, "");
      if (name.includes(q)) return true;
      if (phone.toLowerCase().includes(q)) return true;
      if (qDigits.length > 0 && phoneDigits.includes(qDigits)) return true;
      return false;
    });
  }, [conversations, listSearch]);

  const selected = conversations.find((c) => c.id === selectedId);
  const canResendCurrentFlowStep = Boolean(
    selected &&
      selected.status !== "closed" &&
      selected.flow_code?.trim() &&
      selected.flow_current_node?.trim()
  );
  const isHumanActive =
    !!selected && (selected.human_taken_over || selected.flow_status === "human");
  const requestedConversationId = searchParams?.get("conversationId") ?? null;

  useEffect(() => {
    const chId = selected?.channel?.id?.trim();
    if (!chId || vista === "bot") {
      setChannelQuickReplies([]);
      setQuickReplyOpen(false);
      setQuickReplySearch("");
      return;
    }
    let cancelled = false;
    setQuickRepliesLoading(true);
    void listActiveQuickRepliesForChannel(chId)
      .then((rows) => {
        if (!cancelled) {
          setChannelQuickReplies(rows.map((r) => ({ id: r.id, title: r.title, body: r.body })));
        }
      })
      .catch(() => {
        if (!cancelled) setChannelQuickReplies([]);
      })
      .finally(() => {
        if (!cancelled) setQuickRepliesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.channel?.id, vista]);

  useEffect(() => {
    if (selected?.channel.quick_replies_inbox_enabled === false) {
      setQuickReplyOpen(false);
    }
  }, [selected?.channel.quick_replies_inbox_enabled]);

  useEffect(() => {
    if (!quickReplyOpen) return;
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") setQuickReplyOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [quickReplyOpen]);

  useEffect(() => {
    if (!quickReplyOpen) return;
    function onDoc(ev: MouseEvent) {
      const el = quickReplyPanelRef.current;
      if (!el) return;
      const t = ev.target;
      if (t instanceof Node && el.contains(t)) return;
      setQuickReplyOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [quickReplyOpen]);

  const filteredQuickReplies = useMemo(() => {
    const q = quickReplySearch.trim().toLowerCase();
    if (!q) return channelQuickReplies;
    return channelQuickReplies.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.body.toLowerCase().includes(q)
    );
  }, [channelQuickReplies, quickReplySearch]);

  function insertQuickReplyBody(text: string) {
    const t = text.trim();
    if (!t) return;
    setInput((prev) => {
      if (!prev.trim()) return t;
      return `${prev.trimEnd()}\n\n${t}`;
    });
    setQuickReplyOpen(false);
    setQuickReplySearch("");
  }

  useEffect(() => {
    if (!requestedConversationId || !conversations.length) return;
    if (selectedId === requestedConversationId) return;
    const exists = conversations.some((c) => c.id === requestedConversationId);
    if (!exists) return;
    void handleSelect(requestedConversationId);
  }, [requestedConversationId, conversations, selectedId, handleSelect]);

  const transferFromUrl = searchParams?.get("transferir") === "1";
  const transferUrlConsumed = useRef(false);
  useEffect(() => {
    transferUrlConsumed.current = false;
  }, [transferFromUrl, requestedConversationId]);

  useEffect(() => {
    if (!transferFromUrl || !requestedConversationId) return;
    if (selectedId !== requestedConversationId) return;
    if (transferUrlConsumed.current) return;
    transferUrlConsumed.current = true;
    setTransferModalOpen(true);
    patchInboxQuery({ transferir: null });
  }, [transferFromUrl, requestedConversationId, selectedId, patchInboxQuery]);

  useEffect(() => {
    if (selectedId && !conversations.some((c) => c.id === selectedId)) {
      setSelectedId(null);
      setMessages([]);
    }
  }, [conversations, selectedId]);

  useEffect(() => {
    setCompValidacionesOpen(false);
    setCompApprovalInfo(null);
  }, [selectedId]);

  useEffect(() => {
    if (!finalizeOptions || !finalizeStateId) return;
    const st = finalizeOptions.states.find((s) => s.id === finalizeStateId);
    if (!st) return;
    setFinalizeSubstateId((prev) =>
      st.substates.some((sub) => sub.id === prev) ? prev : st.substates[0]?.id ?? ""
    );
  }, [finalizeStateId, finalizeOptions]);

  return (
    <div className="flex flex-col flex-1 min-h-0 h-[calc(100dvh-4.75rem)] max-h-[calc(100dvh-4.75rem)] gap-1 overflow-hidden">
      <ImageLightbox url={lightboxUrl} onClose={closeLightbox} />

      {compApproveConfirmId ? (
        <div
          className="fixed inset-0 z-[105] flex items-center justify-center bg-black/40 p-4"
          role="presentation"
          onClick={() => setCompApproveConfirmId(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl p-5"
            onClick={(ev) => ev.stopPropagation()}
          >
            <p className="text-sm text-slate-800 font-medium">Confirmar aprobación</p>
            <p className="mt-2 text-xs text-slate-600 leading-relaxed">
              ¿Confirmás aprobar este comprobante y cerrar la compra? Esto generará cupones y enviará el resumen al
              cliente por WhatsApp (y el ticket PNG si el sorteo lo tiene configurado).
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                onClick={() => setCompApproveConfirmId(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={Boolean(compActionId)}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                onClick={() => {
                  const vid = compApproveConfirmId;
                  const convId = selectedId;
                  if (!vid || !convId) return;
                  setCompApproveConfirmId(null);
                  void (async () => {
                    setCompActionId(vid);
                    setSendError(null);
                    setCompApprovalInfo(null);
                    try {
                      const res = await approveComprobanteValidacion(vid);
                      if (!res.ok) {
                        setSendError(res.message);
                      } else if (res.mode === "pending_participant_data") {
                        const parts = [
                          "Comprobante aprobado. Faltan datos del participante; el bot continuará la carga por WhatsApp.",
                          res.nextNodeCode ? `(Siguiente paso: ${res.nextNodeCode})` : "",
                          res.missingFields?.length
                            ? `Pendiente: ${res.missingFields.join(", ")}.`
                            : "",
                        ].filter(Boolean);
                        if (res.whatsappWarning) parts.push(`WhatsApp: ${res.whatsappWarning}`);
                        setCompApprovalInfo(parts.join(" "));
                      } else if (res.mode === "pending_final_confirmation") {
                        const parts = [
                          "Comprobante aprobado. El cliente debe confirmar en el resumen del chat para crear la orden.",
                          res.nextNodeCode ? `(Paso: ${res.nextNodeCode})` : "",
                        ].filter(Boolean);
                        if (res.whatsappWarning) parts.push(`WhatsApp: ${res.whatsappWarning}`);
                        setCompApprovalInfo(parts.join(" "));
                      } else if (res.mode === "order_closed") {
                        const parts = [
                          res.reused ? "Orden ya existente (reutilizada)." : "Compra cerrada.",
                          `Orden Nº ${res.numeroOrden}.`,
                          `${res.cuponesCount} cupón(es).`,
                        ];
                        if (res.whatsappWarning) parts.push(`WhatsApp: ${res.whatsappWarning}`);
                        if (res.ticketWarning) parts.push(`Ticket: ${res.ticketWarning}`);
                        setCompApprovalInfo(parts.join(" "));
                      }
                      const rows = await fetchComprobanteValidacionesForConversation(convId);
                      setCompVals(rows);
                    } catch (e) {
                      setSendError(e instanceof Error ? e.message : "No se pudo aprobar el comprobante");
                    } finally {
                      setCompActionId(null);
                    }
                  })();
                }}
              >
                Aprobar y cerrar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {finalizeOpen ? (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4"
          role="presentation"
          onClick={() => closeFinalizeModal()}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="finalize-chat-title"
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
            onClick={(ev) => ev.stopPropagation()}
          >
            <h2 id="finalize-chat-title" className="text-lg font-semibold text-slate-900">
              Finalizar conversación
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Completá el cierre para guardar el resultado en el historial. Todos los campos son obligatorios.
            </p>
            {finalizeLoading ? (
              <p className="mt-4 text-sm text-slate-500">Cargando opciones…</p>
            ) : finalizeOptions && finalizeOptions.states.length > 0 ? (
              <div className="mt-4 space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Estado</label>
                  <select
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                    value={finalizeStateId}
                    onChange={(e) => setFinalizeStateId(e.target.value)}
                  >
                    {finalizeOptions.states.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                {(() => {
                  const st = finalizeOptions.states.find((s) => s.id === finalizeStateId);
                  if (!st || st.substates.length === 0) return null;
                  return (
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Subestado</label>
                      <select
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                        value={finalizeSubstateId}
                        onChange={(e) => setFinalizeSubstateId(e.target.value)}
                      >
                        <option value="">Elegir…</option>
                        {st.substates.map((sub) => (
                          <option key={sub.id} value={sub.id}>
                            {sub.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })()}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Comentario</label>
                  <textarea
                    className="w-full min-h-[88px] border border-slate-200 rounded-lg px-3 py-2 text-sm resize-y"
                    value={finalizeComment}
                    onChange={(e) => setFinalizeComment(e.target.value)}
                    placeholder="Resumí el resultado o próximos pasos para el equipo."
                  />
                </div>
                {finalizeOptions.source === "fallback" ? (
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5">
                    Esta cola no tiene estados propios configurados. Se muestran opciones por defecto hasta que un
                    administrador los defina en la configuración de la cola.
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="mt-4 text-sm text-red-700">No hay estados de cierre disponibles.</p>
            )}
            {finalizeModalError ? (
              <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-2 py-1.5">
                {finalizeModalError}
              </p>
            ) : null}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={finalizeSaving}
                onClick={() => closeFinalizeModal()}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={finalizeSaving || finalizeLoading || !finalizeOptions || finalizeOptions.states.length === 0}
                onClick={() => void confirmFinalize()}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {finalizeSaving ? "Guardando…" : "Confirmar finalización"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {transferModalOpen && selected && vista !== "bot" ? (
        <div
          className="fixed inset-0 z-[115] flex items-center justify-center bg-black/40 p-4"
          role="presentation"
          onClick={() => setTransferModalOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="transfer-chat-title"
            className="w-full max-w-lg max-h-[min(92vh,720px)] overflow-hidden flex flex-col rounded-2xl border border-slate-200 bg-white shadow-xl"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 shrink-0">
              <div>
                <h2 id="transfer-chat-title" className="text-lg font-semibold text-slate-900">
                  Transferir conversación
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Elegí cola y/o agente. Los números reflejan chats abiertos asignados al agente.
                </p>
              </div>
              <button
                type="button"
                className="rounded-lg border border-slate-200 px-2.5 py-1 text-sm text-slate-600 hover:bg-slate-50 shrink-0"
                onClick={() => setTransferModalOpen(false)}
                aria-label="Cerrar"
              >
                ✕
              </button>
            </div>

            <div className="px-5 py-4 space-y-5 overflow-y-auto overscroll-contain flex-1 min-h-0">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">
                  Colas
                </label>
                <div className="flex flex-wrap gap-2">
                  <select
                    disabled={opsBusy}
                    className="flex-1 min-w-[12rem] border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white"
                    value={transferQueueTarget}
                    onChange={(e) => setTransferQueueTarget(e.target.value)}
                    aria-label="Cola destino y filtro de agentes"
                  >
                    <option value="">Todas las colas (tu alcance)</option>
                    {opsQueues
                      .filter((q) => q.is_active)
                      .map((q) => (
                        <option key={q.id} value={q.id}>
                          {q.nombre}
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    disabled={opsBusy || !transferQueueTarget}
                    onClick={() =>
                      void runConversationOp(async () => {
                        await changeConversationQueue(selected.id, transferQueueTarget);
                        setTransferModalOpen(false);
                      })
                    }
                    className="shrink-0 rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-sky-700 disabled:opacity-50 disabled:pointer-events-none"
                  >
                    Transferir
                  </button>
                </div>
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide">
                    Agentes
                  </label>
                  <input
                    type="search"
                    value={transferAgentSearch}
                    onChange={(e) => setTransferAgentSearch(e.target.value)}
                    placeholder="Buscar"
                    className="w-full max-w-[14rem] border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white placeholder:text-slate-400 outline-none focus:ring-1 focus:ring-sky-400/50 focus:border-sky-300"
                    aria-label="Buscar agente"
                  />
                </div>
                {transferLoadsRefreshing ? (
                  <p className="text-sm text-slate-500 py-6 text-center">Actualizando agentes…</p>
                ) : (
                  <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 max-h-[min(42vh,320px)] overflow-y-auto overscroll-contain bg-slate-50/40">
                    {filteredTransferAgents.length === 0 ? (
                      <p className="text-sm text-slate-500 px-4 py-6 text-center">
                        No hay agentes para mostrar con estos filtros.
                      </p>
                    ) : (
                      filteredTransferAgents.map((a) => {
                        const roleLabel = omnicanalRoleShortLabel(a.omnicanal_role);
                        const isCurrent = a.id === selected.assigned_agent_id;
                        return (
                          <button
                            key={a.id}
                            type="button"
                            disabled={opsBusy || isCurrent}
                            onClick={() =>
                              void runConversationOp(async () => {
                                await assignConversationToAgent(selected.id, a.id);
                                setTransferModalOpen(false);
                              })
                            }
                            className={`w-full text-left px-4 py-3 transition-colors hover:bg-white disabled:opacity-50 disabled:pointer-events-none ${
                              isCurrent ? "bg-emerald-50/80" : ""
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span className="font-semibold text-slate-900 text-sm leading-snug">{a.nombre}</span>
                              {roleLabel ? (
                                <span
                                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border shrink-0 ${omnicanalRoleBadgeClass(a.omnicanal_role)}`}
                                >
                                  {roleLabel}
                                </span>
                              ) : null}
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-white text-slate-700 border border-slate-200">
                                {a.queue_nombre}
                              </span>
                              <span className="text-[11px] text-slate-500">
                                {a.operational_status === "offline" ? "En pausa" : "Disponible"}
                                {!a.is_online ? " · sin sesión" : ""}
                              </span>
                            </div>
                            <div className="flex justify-end mt-2">
                              <span className="text-[11px] text-slate-600 tabular-nums">
                                <span className="inline-flex items-center rounded border border-slate-200 bg-white px-1.5 py-0.5 font-semibold text-slate-800">
                                  {a.active_conversations}
                                </span>{" "}
                                Activos
                              </span>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-800 leading-tight truncate">
            {agentDisplayName}
          </h1>
          <p className="text-xs text-slate-500 leading-snug mt-0.5">
            Omnicanal ·{" "}
            {mode === "historial"
              ? "Historial omnicanal"
              : vista === "inbox"
                ? "Inbox"
                : "Bot"}
            {mode === "historial" ? (
              <>
                {" · "}
                <Link href="/dashboard/conversaciones" className="text-[#0EA5E9] hover:underline font-medium">
                  Inbox
                </Link>
              </>
            ) : null}
          </p>
        </div>
        {mode === "inbox" && opPresenceLoaded && !opInQueues ? (
          initialCabeceraInsignia === "admin" ? (
            <div className="flex flex-col items-end gap-1 shrink-0 max-w-[20rem] text-right">
              <span className="inline-flex items-center rounded-full bg-slate-800 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
                Administrador
              </span>
              <span className="text-[10px] text-slate-600 leading-snug">
                Sin puesto en colas ·{" "}
                <Link href="/configuracion/colas" className="font-semibold text-[#0EA5E9] hover:underline">
                  Colas
                </Link>
              </span>
            </div>
          ) : initialCabeceraInsignia === "supervisor" ? (
            <div className="flex flex-col items-end gap-1 shrink-0 max-w-[20rem] text-right">
              <span className="inline-flex items-center rounded-full bg-indigo-800 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
                Supervisor
              </span>
              <span className="text-[10px] text-slate-600 leading-snug">
                Sin fila de agente en colas ·{" "}
                <Link href="/configuracion/colas" className="font-semibold text-[#0EA5E9] hover:underline">
                  Colas
                </Link>
              </span>
            </div>
          ) : (
            <div className="text-[10px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 max-w-[18rem] text-right leading-snug shrink-0">
              No figurás como agente en ninguna cola: no se muestra el turno Disponible/Pausa. Pedí asignación en{" "}
              <Link href="/configuracion/colas" className="font-semibold text-amber-950 underline-offset-2 hover:underline">
                Configuración → Colas
              </Link>
              .
            </div>
          )
        ) : null}
        {mode === "inbox" && opPresenceLoaded && opInQueues && opStatus !== null ? (
          <div
            className="flex flex-col items-end gap-1 shrink-0"
            role="group"
            aria-label="Disponible u en pausa para recibir chats nuevos por autoasignación"
          >
            <div className="flex flex-col items-end gap-0.5">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Tu turno</span>
                {opPresenceBusy ? (
                  <span className="text-[10px] font-medium text-sky-600 animate-pulse">Guardando…</span>
                ) : null}
              </div>
              <p className="text-[11px] font-bold text-slate-800 tabular-nums">
                Estado actual:{" "}
                <span className={opStatus === "ready" ? "text-emerald-700" : "text-slate-600"}>
                  {opStatus === "ready" ? "Disponible" : "En pausa"}
                </span>
              </p>
            </div>
            <div className="flex items-center gap-0.5 rounded-lg border border-slate-300 bg-slate-100 p-0.5 shadow-inner">
              <button
                type="button"
                disabled={opPresenceBusy}
                className={opPresenceToggleClass(opStatus === "ready", "ready")}
                aria-pressed={opStatus === "ready"}
                aria-label="Marcar disponible para autoasignación (ready)"
                onClick={() => void applyOperationalStatus("ready")}
              >
                Disponible
              </button>
              <button
                type="button"
                disabled={opPresenceBusy}
                className={opPresenceToggleClass(opStatus === "offline", "offline")}
                aria-pressed={opStatus === "offline"}
                aria-label="Pausar recepción de chats nuevos por autoasignación (offline)"
                onClick={() => void applyOperationalStatus("offline")}
              >
                En pausa
              </button>
            </div>
            <span className="text-[10px] text-slate-500 max-w-[15rem] text-right leading-tight hidden sm:block">
              Disponible = entrás en la rotación de nuevos chats. En pausa = no recibís asignaciones automáticas.
            </span>
            <div className="text-[10px] text-slate-700 text-right leading-tight w-full">
              <span className="text-slate-500">
                {opStatus === "ready" ? "Tiempo en Disponible" : "Tiempo en pausa"}:{" "}
              </span>
              {opSince ? (
                <LiveElapsedLabel sinceIso={opSince} />
              ) : (
                <span className="text-slate-400 italic">sin marca de tiempo en DB</span>
              )}
            </div>
            {sessionSinceIso ? (
              <div className="text-[10px] text-slate-600 text-right leading-tight w-full border-t border-slate-200/80 pt-1 mt-0.5">
                <span className="text-slate-500">Sesión en inbox:</span>{" "}
                <LiveElapsedLabel sinceIso={sessionSinceIso} />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {mode === "inbox" && sessionSinceIso && !opInQueues ? (
        <div className="flex justify-end w-full shrink-0 -mt-1">
          <p className="text-[10px] text-slate-500 tabular-nums">
            Sesión en inbox: <LiveElapsedLabel sinceIso={sessionSinceIso} />
          </p>
        </div>
      ) : null}
      {mode === "inbox" && opPresenceErr ? (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded-lg px-2 py-1.5 shrink-0">
          {opPresenceErr}
        </div>
      ) : null}
      {mode === "inbox" && opPresenceOkMsg ? (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs rounded-lg px-2 py-1.5 shrink-0 font-medium">
          {opPresenceOkMsg}
        </div>
      ) : null}

      {mode === "inbox" ? (
        <div className="flex flex-wrap items-stretch gap-2 shrink-0 min-w-0">
          <div className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-slate-100/80 p-1 w-fit shrink-0 self-center">
            <button type="button" className={tabClass(vista === "inbox")} onClick={() => setVista("inbox")}>
              Inbox
            </button>
            {hasActiveBotFlows ? (
              <button type="button" className={tabClass(vista === "bot")} onClick={() => setVista("bot")}>
                Bot
              </button>
            ) : null}
          </div>
          <input
            type="search"
            value={listSearch}
            onChange={(e) => setListSearch(e.target.value)}
            placeholder="Buscar por nombre o número"
            className="flex-1 min-w-[12rem] border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 bg-white placeholder:text-slate-400 outline-none focus:ring-1 focus:ring-sky-400/40 focus:border-sky-300"
            aria-label="Buscar por nombre o número"
          />
        </div>
      ) : null}

      {mode === "historial" ? (
        <div className="flex flex-wrap items-stretch gap-2 shrink-0 min-w-0">
          <input
            type="search"
            value={listSearch}
            onChange={(e) => setListSearch(e.target.value)}
            placeholder="Buscar por nombre o número"
            className="flex-1 min-w-[12rem] border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 bg-white placeholder:text-slate-400 outline-none focus:ring-1 focus:ring-sky-400/40 focus:border-sky-300"
            aria-label="Buscar en historial"
          />
        </div>
      ) : null}

      {(mode === "historial" || vista === "inbox") ? (
        <div className="flex flex-wrap items-end gap-3 shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
          <label className="flex flex-col gap-1 min-w-[12rem]">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Canal</span>
            <select
              className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white min-w-[12rem] max-w-[min(22rem,90vw)]"
              value={displayCanal}
              onChange={(e) => {
                const v = e.target.value.trim();
                setPendingCanal(v.length > 0 ? v : "");
                patchInboxQuery({ canal: v.length > 0 ? v : null });
              }}
              aria-label="Filtrar por canal"
            >
              <option value="">Todos los canales</option>
              {inboxChannels.map((c) => (
                <option key={c.id} value={c.id}>
                  {formatChannelOptionLabel(c)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 min-w-[11rem]">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Cola</span>
            <select
              className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white min-w-[11rem]"
              value={displayCola}
              onChange={(e) => {
                const v = e.target.value.trim();
                setPendingCola(v.length > 0 ? v : "");
                patchInboxQuery({ cola: v.length > 0 ? v : null });
              }}
              aria-label="Filtrar por cola"
            >
              <option value="">Todas (según tu alcance)</option>
              {opsQueues
                .filter((q) => q.is_active)
                .map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.nombre}
                  </option>
                ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 min-w-[11rem]">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Asignación</span>
            <select
              className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white min-w-[11rem]"
              value={displayAsignacion}
              onChange={(e) => {
                const v = e.target.value;
                setPendingAsignacion(v === "" ? "" : v);
                patchInboxQuery({ asignacion: v === "" ? null : v });
              }}
              aria-label="Filtrar por asignación"
            >
              <option value="">Todas</option>
              {opInQueues ? <option value="mios">Asignadas a mí</option> : null}
              <option value="sin_asignar">Sin asignar</option>
            </select>
          </label>
          {initialOmnicanalRole === "supervisor" ? (
            <p className="text-[11px] text-slate-500 max-w-[18rem] leading-snug pb-0.5">
              Colas y vistas acotadas a tu equipo supervisado (mismo criterio que inbox y monitoreo).
            </p>
          ) : null}
        </div>
      ) : null}

      {hasActiveChannel === false && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded-lg px-2 py-2 shrink-0">
          No hay un canal de conversación activo para tu empresa. Los mensajes no se registrarán hasta configurarlo.
        </div>
      )}

      {listError && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-xs rounded-lg px-2 py-1.5 shrink-0">
          {listError}
        </div>
      )}
      {messagesError && (
        <div className="bg-amber-50 border border-amber-200 text-amber-950 text-xs rounded-lg px-2 py-1.5 shrink-0">
          {messagesError}
        </div>
      )}
      {resendFlowNotice && (
        <div
          className={`text-xs rounded-lg px-2 py-1.5 shrink-0 border ${
            resendFlowNotice.kind === "ok"
              ? "bg-emerald-50 border-emerald-200 text-emerald-900"
              : "bg-red-50 border-red-200 text-red-900"
          }`}
          role="status"
        >
          {resendFlowNotice.text}
        </div>
      )}

      <div className="flex flex-1 min-h-0 border border-slate-200 rounded-lg overflow-hidden bg-white shadow-sm">
        {/* Lista — Master/Detail responsive:
              MOBILE (< lg): visible cuando NO hay chat seleccionado, ocupa todo el ancho.
                             Cuando user selecciona un chat -> se oculta y aparece el panel mensajes.
              DESKTOP (>= lg): respeta el toggle manual `listColumnHidden`.
                               Si listColumnHidden=true se oculta tambien en desktop.
              Logica combinada: selectedId controla mobile, listColumnHidden controla desktop.
        */}
        <div className={`${selectedId ? "hidden" : "flex"} ${listColumnHidden ? "lg:hidden" : "lg:flex"} w-full lg:max-w-[min(360px,40vw)] shrink-0 lg:border-r border-slate-200 flex-col min-h-0 bg-slate-50/80`}>
          <div className="px-2 py-1.5 border-b border-slate-200 flex items-center justify-between gap-2 shrink-0">
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Chats</span>
            {/* Solo desktop: en mobile la lista se auto-oculta al seleccionar un chat,
                no hace falta toggle manual. */}
            <button
              type="button"
              onClick={() => setListColumnHidden(true)}
              className="hidden lg:inline-flex text-[10px] font-medium text-slate-500 hover:text-slate-800 px-1.5 py-0.5 rounded border border-transparent hover:border-slate-200 hover:bg-white"
              title="Ocultar lista de chats"
            >
              Ocultar
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
            {loadingList ? (
              <div className="p-4 text-xs text-slate-400 text-center animate-pulse">Cargando…</div>
            ) : conversations.length === 0 ? (
              <div className="p-4 text-xs text-slate-500 text-center space-y-1">
                <p>No hay conversaciones aún</p>
              </div>
            ) : visibleConversations.length === 0 ? (
              <div className="p-4 text-xs text-slate-500 text-center space-y-1">
                <p>Ningún chat coincide con la búsqueda</p>
              </div>
            ) : (
              visibleConversations.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => handleSelect(c.id)}
                  className={`w-full text-left px-2.5 py-2 border-b border-slate-100 hover:bg-white transition-colors ${
                    selectedId === c.id ? "bg-white border-l-[3px] border-l-[#0EA5E9]" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-slate-800 truncate">
                        {c.contact.name?.trim() ? c.contact.name.trim() : "Sin nombre"}
                      </div>
                      <div className="text-xs text-slate-500 font-mono truncate">
                        {c.contact.phone_number || "—"}
                      </div>
                      <div className="mt-1">
                        <ChannelBadge type={c.channel.type} nombre={c.channel.nombre} />
                      </div>
                      <p className="text-xs text-slate-500 truncate mt-1">{c.last_message_preview || "—"}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <div className="flex items-center gap-1">
                        {vista === "bot" ? (
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-700 bg-violet-50 border border-violet-200 px-1.5 py-0.5 rounded">
                            Bot
                          </span>
                        ) : c.human_taken_over || c.flow_status === "human" ? (
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
                            Humano
                          </span>
                        ) : null}
                        {c.unread_count > 0 && (
                          <span className="bg-[#0EA5E9] text-white text-xs font-bold px-2 py-0.5 rounded-full">
                            {c.unread_count}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    <span
                      className={`text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${badgeEstadoClass(c.status)}`}
                    >
                      {labelEstado(c.status)}
                    </span>
                    {c.queue_name ? (
                      <span
                        className="text-[9px] font-medium text-indigo-800 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded truncate max-w-full"
                        title={`Cola: ${c.queue_name}`}
                      >
                        Cola · {c.queue_name}
                      </span>
                    ) : null}
                    {vista !== "bot" ? <InboxReplyTurnBadges c={c} dense /> : null}
                    {c.assigned_agent_name ? (
                      <span
                        className="text-[9px] font-semibold text-emerald-900 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded truncate max-w-full"
                        title={`Agente asignado: ${c.assigned_agent_name}`}
                      >
                        Agente · {c.assigned_agent_name}
                      </span>
                    ) : (
                      (() => {
                        const w = assignmentWaitBadge(c.assignment_wait_code, Boolean(c.queue_id));
                        return (
                          <span
                            className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border truncate max-w-full ${assignmentWaitBadgeClass(w.tone)}`}
                            title="Sin agente asignado"
                          >
                            {w.label}
                          </span>
                        );
                      })()
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Panel mensajes — Master/Detail responsive:
              MOBILE (< lg): visible solo cuando HAY chat seleccionado.
                             Si no, la lista ocupa toda la pantalla.
              DESKTOP (>= lg): siempre visible (con empty state si no hay chat).
        */}
        <div className={`${!selectedId ? "hidden lg:flex" : "flex"} flex-1 flex-col min-w-0 min-h-0 overflow-hidden`}>
          {!selectedId ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-slate-400 text-sm min-h-0 px-2">
              <span>Seleccioná una conversación</span>
              {listColumnHidden ? (
                <button
                  type="button"
                  onClick={() => setListColumnHidden(false)}
                  className="text-xs font-medium text-[#0EA5E9] hover:underline"
                >
                  Mostrar lista de chats
                </button>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
              <div className="px-2 py-1 border-b border-slate-200 bg-white shrink-0">
                {selected ? (
                  <div className="flex flex-col gap-0.5 min-w-0 w-full">
                    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0 flex-1">
                        {/* Boton "Volver a la lista" — solo en mobile. En desktop la lista ya
                            esta visible al costado, no hace falta. min-h/min-w 36px para tap target. */}
                        <button
                          type="button"
                          onClick={() => setSelectedId(null)}
                          className="lg:hidden inline-flex items-center justify-center min-w-[36px] min-h-[36px] -ml-1 rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors shrink-0"
                          aria-label="Volver a la lista de chats"
                          title="Volver"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                            <path fillRule="evenodd" d="M12.78 5.22a.75.75 0 0 1 0 1.06L9.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
                          </svg>
                        </button>
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0 min-w-0">
                          <span className="font-semibold text-slate-900 text-sm leading-tight truncate max-w-[min(100%,14rem)]">
                            {selected.contact.name?.trim() ? selected.contact.name.trim() : "Sin nombre"}
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono tabular-nums shrink-0">
                            {selected.contact.phone_number || "—"}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-0.5 shrink-0">
                          <ChannelBadge type={selected.channel.type} nombre={selected.channel.nombre} />
                          {vista === "bot" ? (
                            <span className="text-[9px] font-semibold text-violet-800 bg-violet-50 border border-violet-200 px-1 py-0.5 rounded shrink-0">
                              Bot
                            </span>
                          ) : isHumanActive ? (
                            <span className="text-[9px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 px-1 py-0.5 rounded shrink-0">
                              Humano
                            </span>
                          ) : null}
                          <span
                            className={`text-[9px] font-semibold uppercase px-1 py-0.5 rounded border shrink-0 ${badgeEstadoClass(selected.status)}`}
                          >
                            {labelEstado(selected.status)}
                          </span>
                          {listColumnHidden ? (
                            <button
                              type="button"
                              onClick={() => setListColumnHidden(false)}
                              className="hidden lg:inline-flex shrink-0 text-[9px] font-medium text-slate-600 hover:text-slate-900 border border-slate-200 rounded px-1 py-0.5 bg-white"
                              title="Mostrar lista de chats"
                            >
                              Chats
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    {vista !== "bot" ? (
                      <div className="flex flex-wrap items-center gap-0.5 min-w-0">
                        {selected.queue_name ? (
                          <span
                            className="text-[9px] font-medium text-indigo-900 bg-indigo-50 border border-indigo-200 rounded px-1 py-0.5 truncate max-w-[10rem]"
                            title="Cola de enrutamiento"
                          >
                            {selected.queue_name}
                          </span>
                        ) : mode === "inbox" ? (
                          <span className="text-[9px] text-slate-600 bg-slate-50 border border-slate-200 rounded px-1 py-0.5">
                            Sin cola
                          </span>
                        ) : null}
                        <InboxReplyTurnBadges c={selected} dense />
                        {selected.assigned_agent_name ? (
                          <span
                            className="text-[9px] font-semibold text-emerald-900 bg-emerald-50 border border-emerald-200 rounded px-1 py-0.5 truncate max-w-[9rem]"
                            title="Agente asignado"
                          >
                            {selected.assigned_agent_name}
                          </span>
                        ) : mode === "inbox" ? (
                          (() => {
                            const w = assignmentWaitBadge(
                              selected.assignment_wait_code,
                              Boolean(selected.queue_id)
                            );
                            return (
                              <span
                                className={`text-[9px] font-semibold rounded px-1 py-0.5 border ${assignmentWaitBadgeClass(w.tone)}`}
                                title="Aún sin agente asignado"
                              >
                                Sin agente · {w.label}
                              </span>
                            );
                          })()
                        ) : null}
                      </div>
                    ) : null}

                    <div className="flex flex-wrap items-center justify-end gap-1 pt-0.5 border-t border-slate-100">
                      {vista !== "bot" ? (
                        <button
                          type="button"
                          disabled={opsBusy}
                          onClick={() => {
                            setTransferAgentSearch("");
                            setTransferQueueTarget(selected.queue_id?.trim() ? selected.queue_id : "");
                            setTransferModalOpen(true);
                          }}
                          className="inline-flex items-center gap-1 rounded-md bg-sky-600 text-white px-2 py-1 text-[11px] font-semibold shadow-sm hover:bg-sky-700 disabled:opacity-50"
                        >
                          <ArrowLeftRight className="w-3.5 h-3.5 shrink-0" aria-hidden />
                          Transferir
                        </button>
                      ) : null}
                      {selected.status !== "closed" && mode === "inbox" ? (
                        <button
                          type="button"
                          disabled={opsBusy || finalizeSaving}
                          onClick={() => void openFinalizeModal()}
                          className="inline-flex items-center rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                        >
                          Finalizar
                        </button>
                      ) : selected.status === "closed" ? (
                        <button
                          type="button"
                          disabled={opsBusy}
                          onClick={() =>
                            void runConversationOp(() =>
                              changeConversationStatus(selected.id, "open")
                            )
                          }
                          className="inline-flex items-center rounded-md border border-emerald-400 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
                        >
                          Reabrir
                        </button>
                      ) : null}
                      {isHumanActive ? (
                        <button
                          type="button"
                          disabled={releasingBot}
                          onClick={() => void handleReleaseToBot()}
                          className="inline-flex items-center rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          {releasingBot ? "…" : "Modo bot"}
                        </button>
                      ) : null}
                      {canResendCurrentFlowStep ? (
                        <button
                          type="button"
                          disabled={resendFlowStepLoading || opsBusy}
                          onClick={() => void handleResendCurrentFlowStep()}
                          title='Vuelve a enviar la pregunta o mensaje del nodo actual sin avanzar el flujo. Útil si el bot quedó trabado o el cliente no recibió el último paso.'
                          className="inline-flex items-center gap-1 rounded-md border border-violet-300 bg-violet-50 px-2 py-1 text-[11px] font-semibold text-violet-900 hover:bg-violet-100 disabled:opacity-50"
                        >
                          <RefreshCw
                            className={`w-3.5 h-3.5 shrink-0 ${resendFlowStepLoading ? "animate-spin" : ""}`}
                            aria-hidden
                          />
                          {resendFlowStepLoading ? "Enviando…" : "Reenviar paso actual"}
                        </button>
                      ) : null}
                      {selected.contact.cliente_id ? (
                        <Link
                          href={`/clientes/${selected.contact.cliente_id}`}
                          className="inline-flex items-center rounded-md px-2 py-1 text-[11px] font-semibold text-[#0EA5E9] hover:underline"
                        >
                          Cliente
                        </Link>
                      ) : null}
                      {selected.contact.crm_prospecto_id ? (
                        <Link
                          href={`/crm/${selected.contact.crm_prospecto_id}`}
                          className="inline-flex items-center rounded-md px-2 py-1 text-[11px] font-semibold text-violet-600 hover:underline"
                        >
                          CRM
                        </Link>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>

              {selected?.channel.comprobante_validation_enabled ? (
                <div className="border-b border-amber-100/90 bg-amber-50/30 shrink-0">
                  <button
                    type="button"
                    onClick={() => setCompValidacionesOpen((o) => !o)}
                    aria-expanded={compValidacionesOpen}
                    className="w-full text-left px-2 py-1 text-xs font-medium text-amber-900 flex items-center justify-between gap-2 hover:bg-amber-50/80"
                  >
                    <span>
                      ⚠️ Validaciones ({compLoading ? "…" : compVals.length})
                    </span>
                    <span className="text-slate-500 tabular-nums shrink-0" aria-hidden>
                      {compValidacionesOpen ? "▲" : "▼"}
                    </span>
                  </button>
                  {compValidacionesOpen ? (
                    <div className="px-2 pb-2 max-h-48 overflow-y-auto overscroll-contain border-t border-amber-100/80">
                      {compApprovalInfo ? (
                        <p className="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-100 rounded px-1.5 py-1 mb-1">
                          {compApprovalInfo}
                        </p>
                      ) : null}
                      {compLoading ? (
                        <p className="text-xs text-slate-500 pt-1">Cargando…</p>
                      ) : compVals.length === 0 ? (
                        <p className="text-xs text-slate-500 pt-1">
                          No hay comprobantes registrados en esta conversación.
                        </p>
                      ) : (
                        <ul className="space-y-1.5 pt-1">
                          {compVals.map((v) => (
                            <li
                              key={v.id}
                              className="flex flex-wrap items-center gap-1.5 text-[11px] bg-white border border-slate-200 rounded-md px-1.5 py-1"
                            >
                              <span className="font-mono text-slate-600">{v.estado_validacion}</span>
                              {v.monto_validacion_status != null && v.monto_validacion_status !== "" ? (
                                <span
                                  className="text-[10px] text-slate-500 max-w-[200px] truncate"
                                  title={v.motivo_validacion ?? ""}
                                >
                                  monto: {v.monto_validacion_status}
                                  {v.monto_validacion_esperado_gs != null
                                    ? ` · esp ${v.monto_validacion_esperado_gs}`
                                    : ""}
                                  {v.monto_validacion_ocr_gs != null ? ` · ocr ${v.monto_validacion_ocr_gs}` : ""}
                                  {v.monto_validacion_diferencia_gs != null
                                    ? ` · Δ ${v.monto_validacion_diferencia_gs}`
                                    : ""}
                                </span>
                              ) : null}
                              {v.bank_val_status != null && v.bank_val_status !== "" ? (
                                <span
                                  className="text-[10px] text-slate-500 max-w-[220px] truncate"
                                  title={v.motivo_validacion ?? ""}
                                >
                                  banco: {v.bank_val_status}
                                  {v.bank_val_coincidencias != null && v.bank_val_min_requeridas != null
                                    ? ` · ${v.bank_val_coincidencias}/${v.bank_val_min_requeridas}`
                                    : ""}
                                </span>
                              ) : null}
                              {v.comprobante_url ? (
                                <a
                                  href={v.comprobante_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[#0EA5E9] hover:underline"
                                >
                                  Ver archivo
                                </a>
                              ) : null}
                              {v.estado_validacion === "aprobado_manual" ? (
                                <span className="text-emerald-700 font-medium">
                                  Aprobado manualmente · Compra cerrada
                                  {v.sorteo_entrada_id ? " ✓" : ""}
                                </span>
                              ) : null}
                              {v.sorteo_entrada_id && v.estado_validacion !== "aprobado_manual" ? (
                                <span className="text-sky-700 font-medium">Compra cerrada (entrada existente)</span>
                              ) : null}
                              {!v.sorteo_entrada_id && v.estado_validacion !== "aprobado_manual" ? (
                                <button
                                  type="button"
                                  disabled={compActionId === v.id}
                                  onClick={() => {
                                    setCompApproveConfirmId(v.id);
                                    setCompApprovalInfo(null);
                                  }}
                                  className="text-emerald-700 font-medium hover:underline disabled:opacity-50"
                                >
                                  Aprobar (cerrar compra)
                                </button>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div
                ref={messagesScrollRef}
                onScroll={onMessagesScroll}
                className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-2 py-1 space-y-0 bg-gradient-to-b from-slate-100/90 to-slate-50/40"
              >
                {loadingMsg ? (
                  <div className="text-center text-slate-400 text-sm py-8">Cargando mensajes…</div>
                ) : messages.length === 0 ? (
                  <div className="text-center text-slate-500 text-sm py-8 px-3">
                    {messagesError
                      ? "No se pudieron cargar los mensajes. Reintentá o revisá la barra de avisos arriba."
                      : "No hay mensajes para esta conversación."}
                  </div>
                ) : (
                  messages.map((m, idx) => {
                    const attachUrl = resolveAttachmentUrl(m);
                    const metaDocName = getMetaInboundDocumentFilename(m.raw_payload);
                    const erpName = getErpAttachmentFilename(m.raw_payload);
                    const showAsImage =
                      m.message_type === "image" ||
                      m.message_type === "sticker" ||
                      (m.message_type === "document" && isImageMimeHint(m.raw_payload, m.message_type));

                    return (
                      <div
                        key={m.id}
                        className={`flex ${m.from_me ? "justify-end" : "justify-start"} py-1.5 ${
                          idx > 0 ? "border-t border-slate-200/55" : ""
                        }`}
                      >
                        <div
                          className={`max-w-[88%] rounded-2xl px-2.5 py-1.5 text-sm ${
                            m.from_me
                              ? "bg-[#0EA5E9] text-white rounded-br-md shadow-md shadow-sky-900/15 ring-1 ring-white/15"
                              : "bg-white text-slate-800 rounded-bl-md border border-slate-200/95 shadow-sm border-l-[3px] border-l-sky-300/90"
                          }`}
                        >
                          {showAsImage && attachUrl ? (
                            <div className="space-y-2">
                              <div
                                className={`text-xs font-medium ${m.from_me ? "text-sky-100" : "text-slate-500"}`}
                              >
                                Imagen
                              </div>
                              <button
                                type="button"
                                className="p-0 border-0 bg-transparent cursor-zoom-in text-left"
                                onClick={() => setLightboxUrl(attachUrl)}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={attachUrl}
                                  alt="Imagen del chat"
                                  className="max-h-52 rounded-lg border border-white/30 bg-white object-contain"
                                />
                              </button>
                              {m.content && m.content !== "[imagen]" ? (
                                <p className="whitespace-pre-wrap break-words text-sm opacity-95">{m.content}</p>
                              ) : null}
                            </div>
                          ) : m.message_type === "audio" ? (
                            <div className="space-y-2">
                              <div
                                className={`text-xs font-medium ${m.from_me ? "text-sky-100" : "text-slate-500"}`}
                              >
                                Audio
                              </div>
                              {attachUrl ? (
                                <audio
                                  controls
                                  src={attachUrl}
                                  className="w-full max-w-[280px] h-9"
                                  preload="metadata"
                                />
                              ) : (
                                <p className="whitespace-pre-wrap break-words text-sm opacity-90">
                                  {m.content ?? "[audio]"}
                                </p>
                              )}
                            </div>
                          ) : m.message_type === "document" || m.message_type === "video" ? (
                            <div className="space-y-2">
                              {attachUrl ? (
                                <a
                                  href={attachUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 no-underline transition-colors ${
                                    m.from_me
                                      ? "border-white/25 bg-sky-500/20 hover:bg-sky-500/30 text-white"
                                      : "border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-900"
                                  }`}
                                >
                                  <span className="text-2xl leading-none shrink-0 select-none" aria-hidden>
                                    {m.message_type === "video" ? "▶️" : "📎"}
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span
                                      className={`block text-[10px] font-bold uppercase tracking-wide ${
                                        m.from_me ? "text-sky-100" : "text-slate-500"
                                      }`}
                                    >
                                      {m.message_type === "video" ? "Video" : "Documento"}
                                    </span>
                                    <span className="block text-sm font-semibold break-words mt-0.5">
                                      {displayFilenameForAttachment(m)}
                                    </span>
                                    <span
                                      className={`block text-[11px] mt-1 ${
                                        m.from_me ? "text-sky-100" : "text-slate-500"
                                      }`}
                                    >
                                      Tocá para abrir o descargar
                                    </span>
                                  </span>
                                </a>
                              ) : (
                                <div>
                                  <div
                                    className={`text-xs font-medium ${m.from_me ? "text-sky-100" : "text-slate-500"}`}
                                  >
                                    {m.message_type === "video" ? "Video" : "Documento"}
                                  </div>
                                  <p className="whitespace-pre-wrap break-words mt-1">
                                    {erpName || metaDocName ? (
                                      <>
                                        <span className="font-medium">{erpName || metaDocName}</span>
                                        {m.content ? (
                                          <>
                                            <br />
                                            {m.content}
                                          </>
                                        ) : null}
                                      </>
                                    ) : (
                                      m.content
                                    )}
                                  </p>
                                </div>
                              )}
                            </div>
                          ) : m.message_type === "image" ? (
                            (() => {
                              const parsed = parseOutgoingImageMessage(m);
                              return (
                                <div className="space-y-2">
                                  <div
                                    className={`text-xs font-medium ${m.from_me ? "text-sky-100" : "text-slate-500"}`}
                                  >
                                    Mensaje con imagen
                                  </div>
                                  {parsed.url ? (
                                    <button
                                      type="button"
                                      className="p-0 border-0 bg-transparent cursor-zoom-in text-left"
                                      onClick={() => setLightboxUrl(parsed.url!)}
                                    >
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img
                                        src={parsed.url}
                                        alt="Imagen enviada"
                                        className="max-h-52 rounded-lg border border-white/30 bg-white object-contain"
                                      />
                                    </button>
                                  ) : null}
                                  {parsed.caption ? (
                                    <p className="whitespace-pre-wrap break-words">{parsed.caption}</p>
                                  ) : null}
                                  {!parsed.url && !parsed.caption ? (
                                    <p className="whitespace-pre-wrap break-words">{m.content}</p>
                                  ) : null}
                                </div>
                              );
                            })()
                          ) : (
                            <p className="whitespace-pre-wrap break-words">{m.content}</p>
                          )}
                          <p
                            className={`text-[10px] mt-1 ${m.from_me ? "text-sky-100" : "text-slate-400"}`}
                          >
                            {formatTime(m.created_at)}
                            {m.message_type !== "text" && ` · ${m.message_type}`}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <form
                onSubmit={handleSend}
                className="p-1.5 border-t border-slate-200 bg-white flex flex-col gap-1 shrink-0 min-h-0"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept="image/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
                  onChange={(e) => void handleSendFile(e)}
                />
                {sendError && (
                  <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-2 py-1">
                    {sendError}
                  </div>
                )}
                <div className="flex gap-1 items-end">
                  <div ref={quickReplyPanelRef} className="relative flex shrink-0 gap-0.5 items-center">
                    <button
                      type="button"
                      disabled={uploadingFile || !selectedId || recordingVoice}
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                      title="Adjuntar imagen, audio o documento"
                      aria-label="Adjuntar archivo"
                    >
                      {uploadingFile ? (
                        <span className="text-xs font-bold">…</span>
                      ) : (
                        <Paperclip className="w-[18px] h-[18px]" aria-hidden />
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={uploadingFile || !selectedId}
                      onClick={() => void toggleVoiceNote()}
                      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border text-slate-600 disabled:opacity-50 ${
                        recordingVoice
                          ? "border-red-300 bg-red-50 text-red-700 hover:bg-red-100"
                          : "border-slate-200 hover:bg-slate-50"
                      }`}
                      title={
                        recordingVoice
                          ? "Detener y enviar nota de voz"
                          : "Grabar nota de voz"
                      }
                      aria-label={recordingVoice ? "Detener grabación y enviar" : "Grabar nota de voz"}
                    >
                      {recordingVoice ? (
                        <Square className="w-[16px] h-[16px] fill-current" aria-hidden />
                      ) : (
                        <Mic className="w-[18px] h-[18px]" aria-hidden />
                      )}
                    </button>
                    {vista !== "bot" && selected?.channel.quick_replies_inbox_enabled !== false ? (
                      <>
                        <button
                          type="button"
                          disabled={!selectedId || quickRepliesLoading}
                          onClick={() => {
                            setQuickReplyOpen((o) => !o);
                            setQuickReplySearch("");
                          }}
                          className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border disabled:opacity-50 ${
                            quickReplyOpen
                              ? "border-sky-400 bg-sky-50 text-sky-800"
                              : "border-slate-200 text-slate-600 hover:bg-slate-50"
                          }`}
                          title="Respuestas rápidas"
                          aria-label="Insertar respuesta rápida"
                          aria-expanded={quickReplyOpen}
                        >
                          <Zap className="w-[18px] h-[18px]" aria-hidden />
                        </button>
                        {quickReplyOpen ? (
                          <div className="absolute bottom-full left-0 z-30 mb-1 flex w-[min(calc(100vw-2rem),20rem)] max-h-72 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                            <div className="border-b border-slate-100 px-2 py-1.5">
                              <input
                                type="search"
                                className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/30"
                                placeholder="Buscar…"
                                value={quickReplySearch}
                                onChange={(e) => setQuickReplySearch(e.target.value)}
                                aria-label="Buscar respuesta rápida"
                                autoFocus
                              />
                            </div>
                            <div className="max-h-56 overflow-y-auto overscroll-contain p-1">
                              {quickRepliesLoading ? (
                                <p className="px-2 py-4 text-center text-xs text-slate-400">Cargando…</p>
                              ) : filteredQuickReplies.length === 0 ? (
                                <p className="px-2 py-4 text-center text-xs text-slate-500">
                                  {channelQuickReplies.length === 0
                                    ? "No hay respuestas configuradas para este canal."
                                    : "Sin coincidencias."}
                                </p>
                              ) : (
                                <ul className="space-y-0.5">
                                  {filteredQuickReplies.map((r) => (
                                    <li key={r.id}>
                                      <button
                                        type="button"
                                        className="w-full rounded-lg px-2 py-2 text-left text-xs hover:bg-slate-50"
                                        onClick={() => insertQuickReplyBody(r.body)}
                                      >
                                        <span className="block font-semibold text-slate-900">{r.title}</span>
                                        <span className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">
                                          {r.body}
                                        </span>
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                  <input
                    className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2.5 py-2 text-sm min-h-[2.25rem] focus:ring-2 focus:ring-[#0EA5E9]/30 focus:border-[#0EA5E9] outline-none"
                    placeholder="Escribí un mensaje…"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    disabled={sending}
                  />
                  <button
                    type="submit"
                    disabled={sending || !input.trim()}
                    className="bg-[#0EA5E9] hover:bg-[#0284C7] disabled:opacity-50 text-white px-3 py-2 rounded-lg text-sm font-medium shrink-0 min-h-[2.25rem]"
                  >
                    {sending ? "…" : "Enviar"}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
