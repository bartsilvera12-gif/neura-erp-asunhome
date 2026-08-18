import { createHash, createHmac, timingSafeEqual } from "crypto";

/**
 * YCloud: header `YCloud-Signature: t={timestamp},s={signature}`
 * Algoritmo oficial (Developer docs): signed_payload = `{timestamp}.{request_body}` **sin** punto final;
 * luego HMAC-SHA256 en **hex** minúsculas.
 * @see https://docs.ycloud.com/reference/webhook-integration-guide
 * (La ayuda antigua mencionaba un punto final extra; la guía de integración usa sin punto.)
 */

export type YCloudSignatureVerifyDebug = {
  ok: boolean;
  /** Variante de string que coincidió con el header (si ok). */
  matched_variant?: "timestamp_body" | "timestamp_body_trailing_dot";
  secret_len: number;
  raw_body_len: number;
  /** SHA-256 del raw body UTF-8 (16 hex) para comprobar que no se re-serializó el JSON. */
  raw_body_sha256_16: string;
  /** SHA-256 del signed_payload candidato usado para el expected (16 hex). */
  signed_payload_sha256_16?: string;
  t_len: number;
  s_len: number;
  s_preview: string;
  expected_hex_preview: string;
  /** Longitud del signed_payload usado para el expected mostrado. */
  signed_payload_len?: number;
};

function sha256Hex16(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex").slice(0, 16);
}

function parseYCloudSignatureHeader(signatureHeader: string): { t: string; s: string } | null {
  let t = "";
  let s = "";
  for (const part of signatureHeader.split(",")) {
    const p = part.trim();
    if (p.startsWith("t=")) t = p.slice(2).trim();
    else if (p.startsWith("s=")) s = p.slice(2).trim();
  }
  if (!t || !s) return null;
  return { t, s };
}

function hmacSha256Hex(secret: string, signedPayload: string): string {
  return createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex");
}

function hexEqualConstantTime(a: string, b: string): boolean {
  const got = a.trim().toLowerCase();
  const exp = b.trim().toLowerCase();
  if (got.length !== exp.length || got.length % 2 !== 0) return false;
  try {
    return timingSafeEqual(Buffer.from(got, "hex"), Buffer.from(exp, "hex"));
  } catch {
    return false;
  }
}

/**
 * Verifica firma YCloud. Prueba en orden:
 * 1) `{t}.{rawBody}` (documentación oficial actual)
 * 2) `{t}.{rawBody}.` (variante legada por si algún entorno aún la usa)
 */
export function verifyYCloudWebhookSignatureWithDebug(
  rawBody: string,
  signatureHeader: string | null | undefined,
  webhookSecret: string
): YCloudSignatureVerifyDebug {
  const secret = webhookSecret.trim();
  const hdr = signatureHeader?.trim() ?? "";
  const base: Omit<YCloudSignatureVerifyDebug, "ok" | "matched_variant" | "signed_payload_sha256_16" | "signed_payload_len"> = {
    secret_len: secret.length,
    raw_body_len: rawBody.length,
    raw_body_sha256_16: sha256Hex16(rawBody),
    t_len: 0,
    s_len: 0,
    s_preview: "",
    expected_hex_preview: "",
  };

  if (!secret || !hdr) {
    return { ...base, ok: false };
  }

  const parsed = parseYCloudSignatureHeader(hdr);
  if (!parsed) {
    return { ...base, ok: false };
  }

  const { t, s } = parsed;
  base.t_len = t.length;
  base.s_len = s.length;
  base.s_preview = s.length > 24 ? `${s.slice(0, 24)}…` : s;

  const variants: { name: YCloudSignatureVerifyDebug["matched_variant"]; payload: string }[] = [
    { name: "timestamp_body", payload: `${t}.${rawBody}` },
    { name: "timestamp_body_trailing_dot", payload: `${t}.${rawBody}.` },
  ];

  for (const v of variants) {
    const expectedHex = hmacSha256Hex(secret, v.payload);
    const preview = expectedHex.length > 24 ? `${expectedHex.slice(0, 24)}…` : expectedHex;
    if (hexEqualConstantTime(s, expectedHex)) {
      return {
        ok: true,
        matched_variant: v.name,
        secret_len: base.secret_len,
        raw_body_len: base.raw_body_len,
        raw_body_sha256_16: base.raw_body_sha256_16,
        signed_payload_sha256_16: sha256Hex16(v.payload),
        signed_payload_len: v.payload.length,
        t_len: base.t_len,
        s_len: base.s_len,
        s_preview: base.s_preview,
        expected_hex_preview: preview,
      };
    }
  }

  const primary = variants[0]!;
  const expectedHex = hmacSha256Hex(secret, primary.payload);
  const preview = expectedHex.length > 24 ? `${expectedHex.slice(0, 24)}…` : expectedHex;
  return {
    ok: false,
    secret_len: base.secret_len,
    raw_body_len: base.raw_body_len,
    raw_body_sha256_16: base.raw_body_sha256_16,
    signed_payload_sha256_16: sha256Hex16(primary.payload),
    signed_payload_len: primary.payload.length,
    t_len: base.t_len,
    s_len: base.s_len,
    s_preview: base.s_preview,
    expected_hex_preview: preview,
  };
}

export function verifyYCloudWebhookSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  webhookSecret: string
): boolean {
  return verifyYCloudWebhookSignatureWithDebug(rawBody, signatureHeader, webhookSecret).ok;
}
