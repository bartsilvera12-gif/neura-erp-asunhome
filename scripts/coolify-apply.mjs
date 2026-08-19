// Gestiona el env de la app en Coolify vía API. Credenciales fuera del repo.
// Subcomandos: list | getenv <uuid> | setdburl <uuid> | redeploy <uuid>
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const cfg = JSON.parse(readFileSync(join(homedir(), ".coolify-neura.json"), "utf8"));
const BASE = cfg.url.replace(/\/$/, "") + "/api/v1";
const H = { Authorization: "Bearer " + cfg.token, Accept: "application/json", "Content-Type": "application/json" };

async function call(path, opts = {}) {
  const res = await fetch(BASE + path, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

function maskDbUrl(v) {
  try { const u = new URL(v); return `${u.protocol}//${u.username}:***@${u.hostname}:${u.port}${u.pathname}${u.search}`; }
  catch { return "(no parseable)"; }
}

const [cmd, uuid] = process.argv.slice(2);

if (cmd === "list") {
  const r = await call("/applications");
  if (r.status !== 200) { console.log("ERR", r.status, JSON.stringify(r.json).slice(0, 300)); process.exit(1); }
  const apps = Array.isArray(r.json) ? r.json : (r.json.data || []);
  for (const a of apps) console.log(`${a.uuid}  | ${a.name}  | ${a.fqdn || a.git_repository || ""}`.slice(0, 160));
  console.log(`\n(${apps.length} apps)`);
} else if (cmd === "getenv") {
  const r = await call(`/applications/${uuid}/envs`);
  if (r.status !== 200) { console.log("ERR", r.status, JSON.stringify(r.json).slice(0, 300)); process.exit(1); }
  const envs = Array.isArray(r.json) ? r.json : (r.json.data || []);
  for (const e of envs) {
    const val = e.key === "SUPABASE_DB_URL" ? maskDbUrl(e.value) : (e.is_buildtime || /KEY|TOKEN|PASSWORD|SECRET/i.test(e.key) ? "***" : e.value);
    console.log(`${e.key} = ${val}`);
  }
} else if (cmd === "showdburl") {
  // Devuelve el SUPABASE_DB_URL actual ENMASCARADO + sus partes (sin password)
  const r = await call(`/applications/${uuid}/envs`);
  const envs = Array.isArray(r.json) ? r.json : (r.json.data || []);
  const e = envs.find((x) => x.key === "SUPABASE_DB_URL");
  if (!e) { console.log("No hay SUPABASE_DB_URL"); process.exit(1); }
  const u = new URL(e.value);
  console.log("ACTUAL:", maskDbUrl(e.value), "| host:", u.hostname, "| port:", u.port, "| user:", u.username, "| passwordLen:", u.password.length);
} else if (cmd === "setdburl") {
  // Repunta SUPABASE_DB_URL al endpoint externo del Postgres self-hosted (187.77.247.54:6432, sslmode=disable).
  // PRESERVA user/password/db actuales (NO inventa ni imprime la password). DRY-RUN por defecto;
  // muta sólo con el 3er arg literal "apply". El destino sale de infra confirmada por el cliente, no de adivinanza.
  const TARGET_HOST = "187.77.247.54";
  const TARGET_PORT = "6432";
  const TARGET_SSLMODE = "disable";
  const apply = process.argv[4] === "apply";
  const r = await call(`/applications/${uuid}/envs`);
  if (r.status !== 200) { console.log("ERR getenv", r.status, JSON.stringify(r.json).slice(0, 300)); process.exit(1); }
  const envs = Array.isArray(r.json) ? r.json : (r.json.data || []);
  const e = envs.find((x) => x.key === "SUPABASE_DB_URL");
  if (!e) { console.log("No existe SUPABASE_DB_URL en este app. Abortando (no se crea desde cero)."); process.exit(1); }
  let u; try { u = new URL(e.value); } catch { console.log("SUPABASE_DB_URL actual no parseable. Abortando."); process.exit(1); }
  if (!u.password) { console.log("El SUPABASE_DB_URL actual no trae password — no la invento. Abortando."); process.exit(1); }
  const before = maskDbUrl(e.value);
  // Sólo cambiamos host/port/sslmode; user/password/db se conservan del valor actual.
  u.hostname = TARGET_HOST; u.port = TARGET_PORT; u.search = `?sslmode=${TARGET_SSLMODE}`;
  const newValue = u.toString();
  const after = maskDbUrl(newValue);
  console.log("ANTES :", before);
  console.log("DESPUÉS:", after, "| passwordLen:", u.password.length, "(misma password conservada)");
  if (before === after) { console.log("Sin cambios — ya apunta al destino. No-op."); process.exit(0); }
  if (!apply) {
    console.log("\n*** DRY-RUN — no se aplicó nada. Para mutar de verdad:");
    console.log(`    node scripts/coolify-apply.mjs setdburl ${uuid} apply`);
    console.log("    (luego redeploy)  node scripts/coolify-apply.mjs redeploy " + uuid + " apply");
    process.exit(0);
  }
  // Mutación real: PATCH del env por key (Coolify API v1).
  const patch = await call(`/applications/${uuid}/envs`, {
    method: "PATCH",
    body: JSON.stringify({ key: "SUPABASE_DB_URL", value: newValue, is_preview: false }),
  });
  console.log("PATCH status:", patch.status, "→", JSON.stringify(patch.json).slice(0, 200));
  if (patch.status >= 200 && patch.status < 300) console.log("✔ SUPABASE_DB_URL actualizado. Falta redeploy para que tome efecto.");
  else { console.log("✗ Falló el PATCH — el env NO se cambió."); process.exit(1); }
} else if (cmd === "redeploy") {
  // Dispara un redeploy del app. DRY-RUN por defecto; ejecuta sólo con 3er arg literal "apply".
  const apply = process.argv[4] === "apply";
  if (!uuid) { console.log("falta <uuid>"); process.exit(1); }
  if (!apply) {
    console.log("DRY-RUN — redeploy NO disparado. Para ejecutar:");
    console.log(`    node scripts/coolify-apply.mjs redeploy ${uuid} apply`);
    process.exit(0);
  }
  const dep = await call(`/deploy?uuid=${encodeURIComponent(uuid)}&force=false`);
  console.log("DEPLOY status:", dep.status, "→", JSON.stringify(dep.json).slice(0, 300));
} else {
  console.log("uso: list | getenv <uuid> | showdburl <uuid> | setdburl <uuid> [apply] | redeploy <uuid> [apply]");
}
