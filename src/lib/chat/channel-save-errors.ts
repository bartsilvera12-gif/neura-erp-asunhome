/**
 * Mensajes de error legibles para guardado de canales (evita SQL / digest en UI).
 */

export type ChannelSaveErrorContext = "ycloud" | "meta" | "generic";

const YCLOUD_DEFAULT = "No se pudo guardar el canal YCloud. Revisá los datos e intentá de nuevo.";
const META_DEFAULT = "No se pudo guardar el canal WhatsApp. Revisá los datos e intentá de nuevo.";
const GENERIC_DEFAULT = "No se pudo guardar el canal. Revisá los datos e intentá de nuevo.";

function stripProductionNoise(msg: string): string {
  const t = msg.trim();
  if (/digest:/i.test(t) || /server components render/i.test(t) || /an error occurred in the server components/i.test(t)) {
    return "";
  }
  return t;
}

export function mapChannelSaveErrorMessage(raw: string, context: ChannelSaveErrorContext): string {
  const cleaned = stripProductionNoise(raw);
  const m = cleaned.toLowerCase();

  if (!cleaned || m.length < 3) {
    return context === "ycloud" ? YCLOUD_DEFAULT : context === "meta" ? META_DEFAULT : GENERIC_DEFAULT;
  }

  if (m.includes("phone number id es obligatorio") || m.includes("phone number id")) {
    return "El Phone Number ID de Meta es obligatorio para este tipo de canal.";
  }

  if (
    (m.includes("meta_phone_number_id") && (m.includes("not null") || m.includes("null value"))) ||
    (m.includes("violates not-null constraint") && m.includes("meta_phone_number"))
  ) {
    return context === "ycloud"
      ? "No se pudo guardar el canal YCloud: la base de datos de esta empresa aún no admite canales sin Phone ID de Meta. Volvé a intentar tras actualizar el esquema (migración omnicanal) o contactá soporte."
      : "No se pudo guardar: falta el identificador de teléfono Meta en la fila del canal.";
  }

  if (m.includes("duplicate key") || m.includes("unique constraint") || m.includes("already exists")) {
    return "Ya existe un canal con ese identificador. Cambiá el dato duplicado o editá el canal existente.";
  }

  if (m.includes("violates check constraint") || m.includes("check constraint")) {
    return context === "ycloud"
      ? "No se pudo guardar el canal YCloud: un valor no cumple las reglas del servidor (tipo de canal o estado). Contactá soporte si persiste."
      : "No se pudo guardar: un valor no cumple las reglas del servidor. Revisá tipo de canal y estado.";
  }

  if (m.includes("permission denied") || m.includes("row-level security") || m.includes("rls")) {
    return "No tenés permiso para guardar este canal con la sesión actual.";
  }

  if (m.includes("usuario no autenticado") || m.includes("sin empresa")) {
    return cleaned;
  }

  if (m.length > 280 && (m.includes("select") || m.includes("insert ") || m.includes("update "))) {
    return context === "ycloud" ? YCLOUD_DEFAULT : context === "meta" ? META_DEFAULT : GENERIC_DEFAULT;
  }

  return cleaned;
}

export function mapChannelSaveError(err: unknown, context: ChannelSaveErrorContext): string {
  const raw = err instanceof Error ? err.message : String(err);
  return mapChannelSaveErrorMessage(raw, context);
}
