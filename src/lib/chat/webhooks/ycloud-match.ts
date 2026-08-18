import { normalizeWaPhone } from "@/lib/chat/wa-phone";

export type YCloudInboundIdentifiers = {
  wabaId: string;
  to: string;
  from: string;
};

function cfgStr(cfg: Record<string, unknown>, key: string): string {
  const v = cfg[key];
  return typeof v === "string" ? v.trim() : "";
}

function onlyDigits(s: string): string {
  return s.replace(/\D/g, "");
}

function wabaTokensMatch(aRaw: string, bRaw: string): boolean {
  const a = aRaw.trim();
  const b = bRaw.trim();
  if (!a || !b) return false;
  if (a === b) return true;
  const da = onlyDigits(a);
  const db = onlyDigits(b);
  return da.length > 0 && da === db;
}

export type YCloudMatchExplain = { matched: boolean; strategy?: string };

/**
 * Explica por qué un canal YCloud coincide (o no) con el payload; útil para logs.
 */
export function explainYCloudChannelMatch(
  row: { provider_channel_id: string | null; config: unknown },
  ids: YCloudInboundIdentifiers
): YCloudMatchExplain {
  const cfg =
    row.config && typeof row.config === "object" && !Array.isArray(row.config)
      ? (row.config as Record<string, unknown>)
      : {};

  const waba = ids.wabaId.trim();
  const ycCh = cfgStr(cfg, "ycloud_channel_id");
  const ycSend = cfgStr(cfg, "ycloud_sender_id");
  const prov = (row.provider_channel_id ?? "").trim();
  const toN = normalizeWaPhone(ids.to);

  if (waba && ycCh && wabaTokensMatch(waba, ycCh)) return { matched: true, strategy: "wabaId=config.ycloud_channel_id" };
  if (waba && prov && wabaTokensMatch(waba, prov)) return { matched: true, strategy: "wabaId=provider_channel_id" };
  if (toN && ycSend && normalizeWaPhone(ycSend) === toN) return { matched: true, strategy: "to=config.ycloud_sender_id" };
  if (toN && prov && normalizeWaPhone(prov) === toN) return { matched: true, strategy: "to=provider_channel_id" };
  return { matched: false };
}

/** Coincidencia heurística canal ERP ↔ payload YCloud (sin validar firma). */
export function channelMatchesYCloudInbound(
  row: { provider_channel_id: string | null; config: unknown },
  ids: YCloudInboundIdentifiers
): boolean {
  return explainYCloudChannelMatch(row, ids).matched;
}
