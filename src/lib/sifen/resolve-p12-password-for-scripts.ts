import { decryptSecret } from "./security";

/**
 * Contraseña del .p12 para scripts locales (E2E, diagnóstico).
 *
 * 1. Intenta descifrar `certificado_password_encrypted` con `SIFEN_SECRETS_KEY` (debe ser la misma
 *    que en el entorno que cifró el valor en BD).
 * 2. Si falla y existe `E2E_CERT_PASSWORD_PLAIN`, usa ese valor (PIN del .p12 en claro).
 *
 * No usar en rutas API de Next.js: solo importar desde `scripts/`.
 */
export function resolveP12PasswordForScripts(encryptedFromDb: string): string {
  const plainFallback = process.env.E2E_CERT_PASSWORD_PLAIN?.trim();
  try {
    return decryptSecret(String(encryptedFromDb));
  } catch {
    if (plainFallback) {
      return plainFallback;
    }
    throw new Error(
      "No se pudo descifrar la contraseña del .p12 (SIFEN_SECRETS_KEY distinta a la usada al guardarla) " +
        "y E2E_CERT_PASSWORD_PLAIN no está definida. Defina E2E_CERT_PASSWORD_PLAIN en .env.local o alinee SIFEN_SECRETS_KEY con producción."
    );
  }
}
