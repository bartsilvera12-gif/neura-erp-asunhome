import { getChatPostgresPool, getChatPostgresConnectionString, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import {
  assertAllowedChatDataSchema,
  isLikelyUnexposedTenantChatSchema,
} from "@/lib/supabase/chat-data-schema";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getChatServiceClientForEmpresa } from "@/lib/supabase/chat-service-role-empresa";

export type ConfirmarImpresionOk = {
  ok: true;
  cupones_impresion_count: number;
  cupones_impresos_at: string;
};

export type ConfirmarImpresionErr = {
  ok: false;
  status: number;
  message: string;
};

export type ConfirmarImpresionResult = ConfirmarImpresionOk | ConfirmarImpresionErr;

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s.trim());
}

/**
 * Confirma impresión física para una entrada: actualiza sorteo_entradas solamente.
 * No modifica sorteo_cupones ni estado_pago.
 */
export async function confirmarImpresionCuponesEntrada(params: {
  empresaId: string;
  usuarioUuid: string | null;
  entradaId: string;
  sorteoId: string;
}): Promise<ConfirmarImpresionResult> {
  const { empresaId, usuarioUuid, entradaId, sorteoId } = params;
  if (!isUuid(entradaId) || !isUuid(sorteoId)) {
    return { ok: false, status: 400, message: "Identificadores inválidos." };
  }

  const dataSchema = await fetchDataSchemaForEmpresaId(empresaId);

  if (isLikelyUnexposedTenantChatSchema(dataSchema)) {
    if (!getChatPostgresConnectionString()) {
      return {
        ok: false,
        status: 503,
        message:
          "Tenant no expuesto en PostgREST: configurá SUPABASE_DB_URL o DIRECT_URL para confirmar impresión.",
      };
    }
    return confirmarPg(empresaId, dataSchema, entradaId, sorteoId, usuarioUuid);
  }

  return confirmarPostgrest(empresaId, entradaId, sorteoId, usuarioUuid);
}

async function confirmarPg(
  empresaId: string,
  dataSchema: string,
  entradaId: string,
  sorteoId: string,
  usuarioUuid: string | null
): Promise<ConfirmarImpresionResult> {
  const pool = getChatPostgresPool();
  if (!pool) {
    return {
      ok: false,
      status: 503,
      message: "Sin pool Postgres para actualizar el esquema del tenant.",
    };
  }

  const sch = assertAllowedChatDataSchema(dataSchema);
  const tEnt = quoteSchemaTable(sch, "sorteo_entradas");
  const tCup = quoteSchemaTable(sch, "sorteo_cupones");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const ver = await client.query(
      `SELECT id FROM ${tEnt}
       WHERE id = $1::uuid AND empresa_id = $2::uuid AND sorteo_id = $3::uuid
       LIMIT 1`,
      [entradaId, empresaId, sorteoId]
    );
    if (!ver.rows?.length) {
      await client.query("ROLLBACK");
      return { ok: false, status: 404, message: "Entrada no encontrada o no pertenece al sorteo." };
    }

    const cntRes = await client.query(
      `SELECT COUNT(*)::bigint AS c FROM ${tCup}
       WHERE empresa_id = $1::uuid AND entrada_id = $2::uuid`,
      [empresaId, entradaId]
    );
    const cupCount = Number((cntRes.rows?.[0] as { c?: string | number } | undefined)?.c ?? 0) || 0;
    if (cupCount < 1) {
      await client.query("ROLLBACK");
      return { ok: false, status: 400, message: "La orden no tiene cupones registrados." };
    }

    const upRes = await client.query(
      `UPDATE ${tEnt}
       SET cupones_impresos_at = now(),
           cupones_impresos_by = $1::uuid,
           cupones_impresion_count = $2::int,
           updated_at = now()
       WHERE id = $3::uuid AND empresa_id = $4::uuid AND sorteo_id = $5::uuid
       RETURNING cupones_impresos_at`,
      [usuarioUuid, cupCount, entradaId, empresaId, sorteoId]
    );

    if (!upRes.rows?.length) {
      await client.query("ROLLBACK");
      return { ok: false, status: 404, message: "No se pudo actualizar la entrada." };
    }

    await client.query("COMMIT");

    const atRaw = (upRes.rows[0] as { cupones_impresos_at?: unknown }).cupones_impresos_at;
    const at =
      atRaw instanceof Date
        ? atRaw.toISOString()
        : typeof atRaw === "string"
          ? atRaw
          : new Date().toISOString();

    return { ok: true, cupones_impresion_count: cupCount, cupones_impresos_at: at };
  } catch (e) {
    await client.query("ROLLBACK");
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 500, message: msg };
  } finally {
    client.release();
  }
}

async function confirmarPostgrest(
  empresaId: string,
  entradaId: string,
  sorteoId: string,
  usuarioUuid: string | null
): Promise<ConfirmarImpresionResult> {
  const sb = await getChatServiceClientForEmpresa(empresaId);

  const { data: ent, error: eEnt } = await sb
    .from("sorteo_entradas")
    .select("id")
    .eq("id", entradaId)
    .eq("empresa_id", empresaId)
    .eq("sorteo_id", sorteoId)
    .maybeSingle();

  if (eEnt) {
    return { ok: false, status: 400, message: eEnt.message };
  }
  if (!ent) {
    return { ok: false, status: 404, message: "Entrada no encontrada o no pertenece al sorteo." };
  }

  const { count, error: eCnt } = await sb
    .from("sorteo_cupones")
    .select("*", { count: "exact", head: true })
    .eq("empresa_id", empresaId)
    .eq("entrada_id", entradaId);

  if (eCnt) {
    return { ok: false, status: 400, message: eCnt.message };
  }
  const cupCount = count ?? 0;
  if (cupCount < 1) {
    return { ok: false, status: 400, message: "La orden no tiene cupones registrados." };
  }

  const row: Record<string, unknown> = {
    cupones_impresos_at: new Date().toISOString(),
    cupones_impresion_count: cupCount,
    updated_at: new Date().toISOString(),
  };
  if (usuarioUuid) {
    row.cupones_impresos_by = usuarioUuid;
  }

  const { data: updated, error: eUp } = await sb
    .from("sorteo_entradas")
    .update(row)
    .eq("id", entradaId)
    .eq("empresa_id", empresaId)
    .eq("sorteo_id", sorteoId)
    .select("cupones_impresos_at")
    .maybeSingle();

  if (eUp) {
    return { ok: false, status: 400, message: eUp.message };
  }
  if (!updated || typeof updated !== "object") {
    return { ok: false, status: 404, message: "No se pudo actualizar la entrada." };
  }

  const atRaw = (updated as { cupones_impresos_at?: string }).cupones_impresos_at;
  return {
    ok: true,
    cupones_impresion_count: cupCount,
    cupones_impresos_at: typeof atRaw === "string" ? atRaw : new Date().toISOString(),
  };
}
