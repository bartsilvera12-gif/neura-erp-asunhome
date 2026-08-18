/**
 * Si la fila `usuarios` no enlaza bien con Auth, igual damos super_admin al correo
 * configurado en env o a los correos bootstrap del producto.
 *
 * NEXT_PUBLIC_SUPER_ADMIN_EMAILS=comma,separated,emails
 */
const BOOTSTRAP = new Set([
  "neurautomations@gmail.com",
  "neuratomations@gmail.com",
]);

export function isBootstrapSuperAdminEmail(email: string | null | undefined): boolean {
  const e = email?.trim().toLowerCase();
  if (!e) return false;
  if (BOOTSTRAP.has(e)) return true;
  const raw = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAILS ?? "";
  const extra = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return extra.includes(e);
}
