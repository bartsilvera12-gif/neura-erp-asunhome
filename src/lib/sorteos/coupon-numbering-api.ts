/**
 * Normalización y validación para guardar sorteos.coupon_number_* desde API.
 */

import "server-only";

import {
  validateSorteoNumberingInput,
  type CouponNumberMode,
} from "@/lib/sorteos/coupon-numbering";

export type CouponNumberingPersist = {
  coupon_numbering_enabled: boolean;
  coupon_number_start: number | null;
  coupon_number_mode: CouponNumberMode | null;
  coupon_number_limit: number | null;
};

export function mergeCouponNumberingFromUnknown(body: Record<string, unknown>): CouponNumberingPersist | { error: string } {
  const enabled = body.coupon_numbering_enabled === true;
  if (!enabled) {
    return {
      coupon_numbering_enabled: false,
      coupon_number_start: null,
      coupon_number_mode: null,
      coupon_number_limit: null,
    };
  }

  const rawStart = body.coupon_number_start;
  const start =
    typeof rawStart === "number"
      ? rawStart
      : typeof rawStart === "string" && rawStart.trim() !== ""
        ? Number(rawStart)
        : null;

  const rawLim = body.coupon_number_limit;
  const limit =
    rawLim === null || rawLim === undefined || String(rawLim).trim() === ""
      ? null
      : typeof rawLim === "number"
        ? rawLim
        : Number(rawLim);

  const modeRaw = typeof body.coupon_number_mode === "string" ? body.coupon_number_mode.trim() : "";
  const mode =
    modeRaw === "correlative" || modeRaw === "random" ? (modeRaw as CouponNumberMode) : null;

  const v = validateSorteoNumberingInput({
    enabled: true,
    start: start != null && Number.isFinite(start) ? Math.trunc(start) : null,
    mode,
    limit: limit != null && Number.isFinite(limit) ? Math.trunc(limit) : null,
  });
  if (!v.ok) return { error: v.message };

  return {
    coupon_numbering_enabled: true,
    coupon_number_start: start != null && Number.isFinite(start) ? Math.trunc(start) : null,
    coupon_number_mode: mode,
    coupon_number_limit:
      limit != null && Number.isFinite(limit) ? Math.trunc(limit) : null,
  };
}
