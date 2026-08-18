/**
 * Genera SIFEN_SECRETS_KEY (32 bytes aleatorios en base64url) y la escribe en .env.local.
 * No imprime el valor por consola. Uso: npx tsx scripts/merge-sifen-secrets-key-into-env-local.ts
 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const envPath = join(process.cwd(), ".env.local");
const key = randomBytes(32).toString("base64url");
const line = `SIFEN_SECRETS_KEY=${key}`;

let content = "";
if (existsSync(envPath)) {
  content = readFileSync(envPath, "utf8");
}

if (/^SIFEN_SECRETS_KEY\s*=/m.test(content)) {
  content = content.replace(/^SIFEN_SECRETS_KEY\s*=.*$/m, line);
} else {
  // Siempre nueva línea antes de la variable (evita pegar al final de la última línea sin \n).
  content = `${content.replace(/\s*$/, "")}\n${line}\n`;
}

writeFileSync(envPath, content, "utf8");
process.stdout.write(
  "OK: SIFEN_SECRETS_KEY generada (32 bytes, base64url) y guardada en .env.local (valor no mostrado).\n"
);
