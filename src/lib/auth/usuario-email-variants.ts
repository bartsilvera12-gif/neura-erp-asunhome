/** Variantes de correo para enlazar Auth ↔ `usuarios` (typo histórico). */
export function usuarioEmailLookupVariants(email: string): string[] {
  const t = email.trim().toLowerCase();
  if (!t) return [];
  const s = new Set<string>();
  s.add(t);
  s.add(t.replace(/neuratomations/g, "neurautomations"));
  s.add(t.replace(/neurautomations/g, "neuratomations"));
  return [...s];
}
