/**
 * Añade un schema tenant al array `schemas` de supabase/config.toml (desarrollo local).
 * Uso: node scripts/add-tenant-schema-to-local-config.mjs erp_miempresa_a1b2c3d4
 */
import fs from "node:fs";
import path from "node:path";

const name = process.argv[2]?.trim();
if (!name || !/^erp_[a-z0-9_]+$/.test(name)) {
  console.error("Uso: node scripts/add-tenant-schema-to-local-config.mjs erp_<slug>_<sufijo>");
  process.exit(1);
}

const cfgPath = path.resolve("supabase/config.toml");
let s = fs.readFileSync(cfgPath, "utf8");
const re = /^schemas\s*=\s*\[([^\]]*)\]/m;
const m = s.match(re);
if (!m) {
  console.error("No se encontró schemas = [...] en config.toml");
  process.exit(1);
}
const inner = m[1];
if (inner.includes(`"${name}"`) || inner.includes(`'${name}'`)) {
  console.log("Ya está en config:", name);
  process.exit(0);
}
const insert = inner.trim().endsWith(",") || inner.trim() === "" ? ` "${name}"` : `, "${name}"`;
const next = `schemas = [${inner}${insert}]`;
s = s.replace(re, next);
fs.writeFileSync(cfgPath, s);
console.log("Schema añadido a supabase/config.toml:", name);
console.log("Reiniciá Supabase local: supabase stop && supabase start");
