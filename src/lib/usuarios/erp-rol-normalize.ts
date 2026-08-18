/**
 * Valores funcionales de `usuarios.rol` en el ERP (creación vía UI/API en minúsculas).
 * En bases heredadas puede haber distinto casing o espacios; siempre comparar normalizado.
 */
export function normalizeErpRolSlug(rol: string | null | undefined): string {
  return (rol ?? "").trim().toLowerCase().normalize("NFC");
}

export function isErpRolSupervisor(rol: string | null | undefined): boolean {
  return normalizeErpRolSlug(rol) === "supervisor";
}

export function isErpRolUsuario(rol: string | null | undefined): boolean {
  return normalizeErpRolSlug(rol) === "usuario";
}

export function isErpRolAdministrador(rol: string | null | undefined): boolean {
  const r = normalizeErpRolSlug(rol);
  return r === "administrador" || r === "admin";
}

export function isErpRolVendedor(rol: string | null | undefined): boolean {
  const r = normalizeErpRolSlug(rol);
  return r === "vendedor" || r === "asesor" || r === "comercial" || r === "asesor comercial";
}
