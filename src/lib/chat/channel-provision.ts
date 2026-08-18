import type { SupabaseAdmin } from "@/lib/chat/types";
import { createServiceRoleClientWithDbSchema } from "@/lib/supabase/empresa-data-schema";
import { SUPABASE_APP_SCHEMA, resolveEmpresaDataSchema } from "@/lib/supabase/schema";

export type WebhookProvisionEnv = {
  /** UUID empresa donde crear el canal si coincide el número de Meta */
  defaultEmpresaId: string | undefined;
  /** Debe coincidir con metadata.phone_number_id del webhook (seguridad) */
  expectedPhoneNumberId: string | undefined;
};

/**
 * Si no hay fila en chat_channels, crea una usando variables de entorno (demo / single-tenant).
 * Solo actúa cuando phoneNumberId === expectedPhoneNumberId y defaultEmpresaId está definido.
 * El canal se crea en `empresas.data_schema` (tenant) o en zentra_erp; si es tenant, registra `omnichannel_routes` en catálogo.
 */
export async function provisionChannelFromWebhookEnv(
  catalogSupabase: SupabaseAdmin,
  phoneNumberId: string,
  env: WebhookProvisionEnv
): Promise<{ id: string; empresa_id: string; meta_phone_number_id: string } | null> {
  const expected = env.expectedPhoneNumberId?.trim();
  const empresaId = env.defaultEmpresaId?.trim();
  if (!expected || !empresaId || phoneNumberId !== expected) {
    return null;
  }

  const { data: emp } = await catalogSupabase
    .from("empresas")
    .select("data_schema")
    .eq("id", empresaId)
    .maybeSingle();

  const dataSchema = resolveEmpresaDataSchema((emp as { data_schema?: string | null } | null)?.data_schema);

  const target: SupabaseAdmin =
    dataSchema === SUPABASE_APP_SCHEMA
      ? catalogSupabase
      : (createServiceRoleClientWithDbSchema(dataSchema) as SupabaseAdmin);

  const { data: dup } = await target
    .from("chat_channels")
    .select("id, empresa_id, meta_phone_number_id")
    .eq("meta_phone_number_id", phoneNumberId)
    .maybeSingle();

  if (dup) {
    return {
      id: dup.id as string,
      empresa_id: dup.empresa_id as string,
      meta_phone_number_id: dup.meta_phone_number_id as string,
    };
  }

  const config = {
    phone_number_id: phoneNumberId,
    auto_provisioned: true,
    provisioned_at: new Date().toISOString(),
  };

  const { data: row, error } = await target
    .from("chat_channels")
    .insert({
      empresa_id: empresaId,
      type: "whatsapp",
      meta_phone_number_id: phoneNumberId,
      nombre: "WhatsApp (Meta)",
      provider: "meta",
      provider_channel_id: phoneNumberId,
      activo: true,
      config,
    })
    .select("id, empresa_id, meta_phone_number_id")
    .single();

  if (error || !row) {
    console.error("[channel-provision] insert:", error?.message);
    return null;
  }

  if (dataSchema !== SUPABASE_APP_SCHEMA) {
    const { error: rErr } = await catalogSupabase.from("omnichannel_routes").upsert(
      {
        meta_phone_number_id: phoneNumberId,
        empresa_id: empresaId,
        channel_id: row.id as string,
        data_schema: dataSchema,
      },
      { onConflict: "meta_phone_number_id" }
    );
    if (rErr) {
      console.error("[channel-provision] omnichannel_routes:", rErr.message);
    }
  }

  return {
    id: row.id as string,
    empresa_id: row.empresa_id as string,
    meta_phone_number_id: row.meta_phone_number_id as string,
  };
}
