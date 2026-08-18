/**
 * Consulta estado de deploy en Vercel sin imprimir VERCEL_TOKEN ni secretos.
 * Carga variables desde .env.local (no commitear).
 *
 * Uso: npx tsx scripts/check-vercel-deploy.ts [--sync-ids]
 *
 * --sync-ids  Escribe VERCEL_ORG_ID y VERCEL_PROJECT_ID en .env.local si faltan.
 */
import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { config } from "dotenv";

const API = "https://api.vercel.com";

config({ path: join(process.cwd(), ".env.local"), quiet: true });

type VercelUser = { username?: string; email?: string };
type VercelProject = { id: string; name: string; accountId: string };
type VercelDeployment = {
  uid?: string;
  id?: string;
  url?: string;
  readyState?: string;
  createdAt?: number;
  state?: string;
  meta?: Record<string, string | undefined>;
};

function maskEmail(email: string): string {
  const [a, d] = email.split("@");
  if (!d || !a) return "(oculto)";
  return `${a.slice(0, 2)}…@${d}`;
}

function authHeaders(): HeadersInit {
  const t = process.env.VERCEL_TOKEN?.trim();
  if (!t) throw new Error("Falta VERCEL_TOKEN en .env.local");
  return { Authorization: `Bearer ${t}` };
}

function upsertEnvLocalKey(key: string, value: string): void {
  const envPath = join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) throw new Error("No existe .env.local");
  let raw = readFileSync(envPath, "utf8");
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=.*\\r?\\n?`, "m");
  if (re.test(raw)) {
    raw = raw.replace(re, `${line}\n`);
  } else {
    raw = raw.replace(/\s*$/, `\n${line}\n`);
  }
  writeFileSync(envPath, raw, "utf8");
}

async function getUser(): Promise<VercelUser> {
  const r = await fetch(`${API}/v2/user`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`GET /v2/user → HTTP ${r.status}`);
  const j = (await r.json()) as { user?: VercelUser };
  return j.user ?? {};
}

async function listProjects(): Promise<VercelProject[]> {
  const r = await fetch(`${API}/v9/projects`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`GET /v9/projects → HTTP ${r.status}`);
  const j = (await r.json()) as { projects?: VercelProject[] };
  return j.projects ?? [];
}

async function lastProductionDeployment(projectId: string): Promise<VercelDeployment | null> {
  const q = new URLSearchParams({
    projectId,
    target: "production",
    limit: "20",
  });
  const r = await fetch(`${API}/v6/deployments?${q.toString()}`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`GET /v6/deployments → HTTP ${r.status}`);
  const j = (await r.json()) as { deployments?: VercelDeployment[] };
  const list = j.deployments ?? [];
  if (list.length === 0) return null;
  const sorted = [...list].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return sorted[0] ?? null;
}

function shortSha(full: string | undefined): string {
  if (!full) return "";
  return full.length >= 7 ? full.slice(0, 7) : full;
}

/** true si `minRef` es ancestro de `commit` (mismo historial local). */
function isCommitAtOrAfter(minRef: string, commit: string | undefined): "sí" | "no" | "n/d" {
  if (!commit?.trim() || !minRef.trim()) return "n/d";
  try {
    execSync(`git merge-base --is-ancestor ${minRef} ${commit}`, { stdio: "ignore" });
    return "sí";
  } catch {
    return "no";
  }
}

function tryGitHead(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

async function main(): Promise<void> {
  const syncIds = process.argv.includes("--sync-ids");
  const projectName = process.env.VERCEL_PROJECT_NAME?.trim() || "neura-erp";
  const productionUrl = process.env.VERCEL_PRODUCTION_URL?.trim() || "https://neura-erp.vercel.app";

  const user = await getUser();
  const projects = await listProjects();
  const project = projects.find((p) => p.name === projectName) ?? null;

  if (!project) {
    console.log("Proyectos accesibles con este token (nombres):", projects.map((p) => p.name).join(", ") || "(ninguno)");
    throw new Error(`No se encontró el proyecto \"${projectName}\". Ajustá VERCEL_PROJECT_NAME o el scope del token.`);
  }

  const orgId = project.accountId;
  if (syncIds) {
    upsertEnvLocalKey("VERCEL_ORG_ID", orgId);
    upsertEnvLocalKey("VERCEL_PROJECT_ID", project.id);
    console.log("[check-vercel-deploy] --sync-ids: actualizado VERCEL_ORG_ID y VERCEL_PROJECT_ID en .env.local");
  }

  const projectId = process.env.VERCEL_PROJECT_ID?.trim() || project.id;
  const dep = await lastProductionDeployment(projectId);

  const localHead = tryGitHead();
  const depSha =
    dep?.meta?.githubCommitSha ||
    (dep?.meta as { gitCommitSha?: string } | undefined)?.gitCommitSha ||
    "";
  const depUrl = dep?.url ? `https://${dep.url}` : "";
  const min528 = "528b022";
  const min99 = "99d4532";

  console.log("--- Vercel (sin secretos) ---");
  const showEmail = process.env.VERCEL_CHECK_VERBOSE === "1";
  console.log(
    "Usuario (API):",
    user.username ?? "(sin username)",
    showEmail && user.email ? `— email: ${maskEmail(user.email)}` : ""
  );
  console.log("Proyecto:", projectName);
  console.log("VERCEL_PROJECT_ID:", projectId);
  console.log("VERCEL_ORG_ID (accountId):", orgId);
  console.log("--- Último deployment production (API) ---");
  if (!dep) {
    console.log("Sin deployments production recientes.");
  } else {
    console.log("uid:", dep.uid ?? dep.id ?? "");
    console.log("url:", depUrl);
    console.log("estado (readyState):", dep.readyState ?? dep.state ?? "");
    console.log("createdAt:", dep.createdAt ? new Date(dep.createdAt).toISOString() : "");
    console.log("commit (meta.githubCommitSha):", depSha || "(no informado en meta)");
  }
  console.log("--- Git local ---");
  console.log("git rev-parse HEAD:", localHead || "(no es repo o sin git)");
  console.log("--- Comparación producción vs mínimos (git local) ---");
  const g528 = depSha ? isCommitAtOrAfter(min528, depSha) : "n/d";
  const g99 = depSha ? isCommitAtOrAfter(min99, depSha) : "n/d";
  console.log(
    `commit productivo: ${depSha ? shortSha(depSha) : "n/d"} (completo en Vercel si aplica) | ancestro de ${min528}…: ${g528} | ancestro de ${min99}…: ${g99}`
  );
  if (g528 === "no" || g99 === "no") {
    console.log("Nota: \"no\" puede deberse a que el commit de Vercel no está en tu clon, o a que hace falta redeploy.");
  }
  const sameAsLocal = localHead && depSha && localHead.toLowerCase() === depSha.toLowerCase();
  console.log("¿Coincide deploy con HEAD local?:", sameAsLocal ? "sí" : "no o no comparable");
  console.log("--- /api/deploy-info (producción) ---");
  try {
    const di = await fetch(`${productionUrl.replace(/\/$/, "")}/api/deploy-info`);
    const info = (await di.json()) as { commit?: string; env?: string };
    console.log("HTTP:", di.status, "commit:", info.commit?.slice(0, 7) ?? "n/d", "env:", info.env ?? "n/d");
  } catch (e) {
    console.log("No se pudo leer /api/deploy-info:", e instanceof Error ? e.message : e);
  }
  console.log("-----------------------------");
}

main().catch((e) => {
  console.error("Error:", e instanceof Error ? e.message : e);
  process.exit(1);
});
