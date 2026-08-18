import { NextResponse } from "next/server";

function hostnameFromNextPublicSupabaseUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).hostname;
  } catch {
    return null;
  }
}

/**
 * GET /api/deploy-info
 * Build en Vercel: comparar `commit` con GitHub (ej. 2240452).
 */
export async function GET() {
  const sha =
    process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
    process.env.VERCEL_GIT_COMMIT_REF?.trim() ||
    null;
  const vercelEnv = process.env.VERCEL_ENV ?? null;

  return NextResponse.json({
    /** Alias pedido para depuración (mismo valor que git_commit_sha en Vercel). */
    commit: sha,
    /** Alias pedido: production | preview | development | null si no es Vercel. */
    env: vercelEnv,
    git_commit_sha: sha,
    vercel_env: vercelEnv,
    supabase_api_hostname: hostnameFromNextPublicSupabaseUrl(),
    neura_auth_bundle: "api-auth-context-v2-rls",
  });
}
