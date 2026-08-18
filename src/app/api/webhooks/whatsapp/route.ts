import { NextRequest } from "next/server";
import { handleWhatsAppWebhookPost } from "@/lib/chat/webhooks/meta-whatsapp-webhook-handlers";

/**
 * GET: verificación webhook Meta — texto plano, solo `hub.challenge` (200).
 * POST: firma `X-Hub-Signature-256` si existe `WHATSAPP_APP_SECRET`.
 *
 * Prioridad Next.js: esta ruta estática gana sobre `api/webhooks/[channel]` para la misma URL.
 */

export const dynamic = "force-dynamic";

const LOG_PREFIX = "[api/webhooks/whatsapp][GET]";

function diagHeaders(): HeadersInit {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? "";
  return {
    ...(sha ? { "x-neura-git-sha": sha } : {}),
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const modeRaw = searchParams.get("hub.mode");
  const tokenRaw = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
  const mode = modeRaw?.trim() ?? "";
  const token = tokenRaw?.trim() ?? "";
  const expected = VERIFY_TOKEN?.trim() ?? "";

  const has_verify_token_env = Boolean(expected.length > 0);
  const mode_received = modeRaw !== null && modeRaw !== "";
  const token_received = tokenRaw !== null && tokenRaw !== "";
  const token_match =
    mode === "subscribe" && token.length > 0 && expected.length > 0 && token === expected;

  console.info(LOG_PREFIX, {
    has_verify_token_env,
    mode_received,
    token_received,
    token_match,
    hub_mode_equals_subscribe: mode === "subscribe",
    /** longitudes solo; nunca el valor del token */
    verify_token_env_len: expected.length,
    hub_verify_token_len: token.length,
  });

  if (token_match) {
    return new Response(challenge, {
      status: 200,
      headers: {
        "Content-Type": "text/plain",
        ...diagHeaders(),
      },
    });
  }

  return new Response("Forbidden", {
    status: 403,
    headers: diagHeaders(),
  });
}

export async function POST(request: NextRequest) {
  return handleWhatsAppWebhookPost(request);
}
