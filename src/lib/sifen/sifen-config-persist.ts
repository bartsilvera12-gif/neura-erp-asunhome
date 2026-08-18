import { encryptSecret } from "./security";

/**
 * Asigna `certificado_password_encrypted` en el objeto de insert/update.
 * `undefined` = no tocar la columna en el merge final (omitir clave).
 */
export function mergeCertificadoPasswordEncryptedForInsert(
  row: Record<string, unknown>,
  password: string | null | undefined
): void {
  if (password === undefined) return;
  if (password === null) {
    row.certificado_password_encrypted = null;
    return;
  }
  row.certificado_password_encrypted = encryptSecret(password);
}
