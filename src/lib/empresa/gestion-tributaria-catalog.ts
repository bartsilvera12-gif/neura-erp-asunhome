import { createServiceRoleClient } from "@/lib/supabase/service-admin";

export async function getGestionTributariaClientes(empresaId: string): Promise<boolean> {
  const sb = createServiceRoleClient();
  const { data, error } = await sb
    .from("empresas")
    .select("gestion_tributaria_clientes")
    .eq("id", empresaId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return Boolean((data as { gestion_tributaria_clientes?: boolean } | null)?.gestion_tributaria_clientes);
}

export async function setGestionTributariaClientes(empresaId: string, value: boolean): Promise<void> {
  const sb = createServiceRoleClient();
  const { error } = await sb.from("empresas").update({ gestion_tributaria_clientes: value }).eq("id", empresaId);
  if (error) throw new Error(error.message);
}
