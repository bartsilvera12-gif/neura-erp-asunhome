/**
 * Lead automático CRM al primer contacto por WhatsApp (Meta / YCloud).
 * Usa el mismo esquema tenant que `chat_*` vía `chatSupabase` y CRM vía service role interno en `saveProspectoFromWebhook`.
 */
import { saveProspectoFromWebhook } from "@/lib/crm/storage";
import type { SupabaseAdmin } from "@/lib/chat/types";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";

export async function resolveInitialCrmEtapaCodigo(
  supabase: SupabaseAdmin,
  empresaId: string
): Promise<string> {
  const { data, error } = await supabase
    .from("crm_etapas")
    .select("codigo")
    .eq("empresa_id", empresaId)
    .eq("activo", true)
    .order("orden", { ascending: true });

  if (error) {
    console.error("[crm][whatsapp-inbound-lead] resolveInitialCrmEtapaCodigo:", error.message);
    console.warn("[crm][whatsapp-inbound-lead] etapa fallback LEAD (error consultando crm_etapas)");
    return "LEAD";
  }

  const rows = (data ?? []) as Array<{ codigo?: string | null }>;
  if (rows.length === 0) {
    console.warn(
      "[crm][whatsapp-inbound-lead] crm_etapas vacío para empresa; usando etapa LEAD (webhook WhatsApp)"
    );
    return "LEAD";
  }

  const terminal = new Set(["GANADO", "PERDIDO"]);
  const candidate = rows.find((r) => r.codigo && !terminal.has(String(r.codigo)))?.codigo ?? null;
  if (candidate) return String(candidate);
  return rows[0]?.codigo ? String(rows[0].codigo) : "LEAD";
}

async function resolveChannelCreadoPorLabel(
  chatSupabase: SupabaseAdmin,
  empresaId: string,
  channelId: string
): Promise<string> {
  const { data, error } = await chatSupabase
    .from("chat_channels")
    .select("nombre, provider, type")
    .eq("id", channelId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (error) {
    console.warn("[crm][whatsapp-inbound-lead] canal:", error.message);
  }
  const row = data as { nombre?: string | null; provider?: string | null; type?: string | null } | null;
  const nombre = row?.nombre?.trim();
  if (nombre) return nombre;
  const prov = String(row?.provider ?? "whatsapp").toLowerCase();
  const tipo = String(row?.type ?? "whatsapp");
  if (prov === "ycloud") return `WhatsApp (${tipo}) · YCloud`;
  return `WhatsApp (${tipo})`;
}

async function resolveAssignedAdvisorDisplayName(
  chatSupabase: SupabaseAdmin,
  empresaId: string,
  conversationId: string
): Promise<string | null> {
  const { data: conv, error: cErr } = await chatSupabase
    .from("chat_conversations")
    .select("assigned_agent_id")
    .eq("id", conversationId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (cErr || !conv) return null;
  const agentId = (conv as { assigned_agent_id?: string | null }).assigned_agent_id;
  if (!agentId) return null;

  const { data: ag, error: aErr } = await chatSupabase
    .from("chat_agents")
    .select("usuario_id")
    .eq("id", agentId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (aErr || !ag) return null;
  const usuarioId = (ag as { usuario_id?: string }).usuario_id;
  if (!usuarioId) return null;

  const catalog = createServiceRoleClient();
  const { data: u, error: uErr } = await catalog
    .from("usuarios")
    .select("nombre, email")
    .eq("id", usuarioId)
    .maybeSingle();
  if (uErr || !u) return null;
  const row = u as { nombre?: string | null; email?: string | null };
  const nom = row.nombre?.trim();
  if (nom) return nom;
  return row.email?.trim() || null;
}

/**
 * Si el contacto aún no tiene prospecto CRM, crea uno y lo enlaza.
 * Debe llamarse tras la autoasignación a cola/agente cuando aplique, para poder rellenar `responsable`.
 */
export async function ensureWhatsappInboundCrmProspecto(input: {
  chatSupabase: SupabaseAdmin;
  etapaSupabase: SupabaseAdmin;
  empresaId: string;
  contactId: string;
  conversationId: string;
  channelId: string;
  firstMessagePreview?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const {
    chatSupabase,
    etapaSupabase,
    empresaId,
    contactId,
    conversationId,
    channelId,
    firstMessagePreview,
  } = input;

  const { data: contact, error: ctErr } = await chatSupabase
    .from("chat_contacts")
    .select("id, crm_prospecto_id, phone_number, name")
    .eq("id", contactId)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (ctErr || !contact) {
    return { ok: false, error: ctErr?.message ?? "Contacto no encontrado" };
  }

  const crmPid = (contact as { crm_prospecto_id?: string | null }).crm_prospecto_id;
  if (crmPid) return { ok: true };

  const etapaCodigo = await resolveInitialCrmEtapaCodigo(etapaSupabase, empresaId);

  const phone = String((contact as { phone_number?: string | null }).phone_number ?? "").trim();
  const displayName = String((contact as { name?: string | null }).name ?? "").trim() || phone || "Contacto WhatsApp";
  const creadoPor = await resolveChannelCreadoPorLabel(chatSupabase, empresaId, channelId);
  const responsable = await resolveAssignedAdvisorDisplayName(chatSupabase, empresaId, conversationId);

  const prospecto = await saveProspectoFromWebhook({
    empresa_id: empresaId,
    telefono: phone || displayName,
    contacto: displayName,
    empresa_nombre: "WhatsApp",
    etapa: etapaCodigo,
    origen_creacion: "whatsapp",
    origen_detalle: null,
    servicio: "Consulta por WhatsApp",
    creado_por: creadoPor,
    responsable: responsable ?? undefined,
    mensaje: firstMessagePreview?.trim() || undefined,
  });

  if (!prospecto?.id) {
    return { ok: false, error: "CRM: no se pudo crear el prospecto" };
  }

  const { error: upErr } = await chatSupabase
    .from("chat_contacts")
    .update({ crm_prospecto_id: prospecto.id, updated_at: new Date().toISOString() })
    .eq("id", contactId)
    .eq("empresa_id", empresaId);

  if (upErr) {
    console.error("[crm][whatsapp-inbound-lead] enlazar contacto:", upErr.message);
    return { ok: false, error: upErr.message };
  }

  return { ok: true };
}
