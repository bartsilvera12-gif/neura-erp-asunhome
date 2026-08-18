import "server-only";

const DEFAULT_LOOKBACK_DAYS = 7;

/** Misma ventana que RESPONDIERON (`CAMPAIGN_REPLY_LOOKBACK_DAYS`, default 7). */
export function campaignReplyLookbackMs(): number {
  const raw = process.env.CAMPAIGN_REPLY_LOOKBACK_DAYS?.trim();
  const n = raw ? parseInt(raw, 10) : DEFAULT_LOOKBACK_DAYS;
  const days = !Number.isNaN(n) && n >= 1 && n <= 90 ? n : DEFAULT_LOOKBACK_DAYS;
  return days * 24 * 60 * 60 * 1000;
}
