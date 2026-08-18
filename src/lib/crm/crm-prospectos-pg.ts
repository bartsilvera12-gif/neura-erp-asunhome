/**
 * CRM prospectos/notas en schema tenant vía Postgres (sin PostgREST para erp_* / er_* no expuestos).
 */
import type { Pool, PoolClient } from "pg";
import { quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import { SUPABASE_APP_SCHEMA } from "@/lib/supabase/schema";
import { nextNumeroControlFromLast } from "@/lib/crm/numero-control";
import type { Nota, Prospecto } from "@/lib/crm/types";
import { sqlCrmEtapasDefaultsValuesBlock } from "@/lib/crm/crm-etapas-defaults";
import { normalizeEtapaCodigo } from "@/lib/crm/etapas";

const LOG_LIST = "[crm-prospectos-pg][list]";

export type PgQueryable = Pick<Pool, "query">;

export type ProspectoRowPg = Record<string, unknown>;

export const whatsappCrmLogs = {
  FIND: "[whatsapp-crm][find_or_create_prospect]",
  LINK: "[whatsapp-crm][link_contact_prospect]",
  STAGE: "[whatsapp-crm][funnel_stage]",
} as const;

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") return v;
  return v != null ? String(v) : "";
}

function rowToNotaPg(row: ProspectoRowPg): Nota {
  return {
    id: String(row.id ?? ""),
    texto: String(row.texto ?? ""),
    fecha: toIso(row.fecha),
  };
}

function rowToProspectoPg(row: ProspectoRowPg, notas: Nota[]): Prospecto {
  const od = row.origen_detalle;
  return {
    id: String(row.id ?? ""),
    numero_control: String(row.numero_control ?? ""),
    empresa: String(row.empresa ?? ""),
    contacto: String(row.contacto ?? ""),
    email: row.email != null ? String(row.email) : undefined,
    telefono: row.telefono != null ? String(row.telefono) : undefined,
    servicio: String(row.servicio ?? ""),
    valor_estimado: Number(row.valor_estimado ?? 0),
    etapa: normalizeEtapaCodigo(String(row.etapa ?? "")),
    proxima_accion: row.proxima_accion != null ? String(row.proxima_accion) : undefined,
    fecha_proxima_accion: row.fecha_proxima_accion != null ? String(row.fecha_proxima_accion) : undefined,
    creado_por: row.creado_por != null ? String(row.creado_por) : undefined,
    origen_creacion: (row.origen_creacion ?? "manual") as Prospecto["origen_creacion"],
    origen_detalle: od != null && String(od).trim() !== "" ? String(od) : null,
    responsable: row.responsable != null ? String(row.responsable) : undefined,
    observaciones:
      row.observaciones != null && String(row.observaciones).trim() !== ""
        ? String(row.observaciones)
        : null,
    notas,
    fecha_creacion: toIso(row.fecha_creacion),
    fecha_actualizacion: toIso(row.fecha_actualizacion),
    cliente_creado: Boolean(row.cliente_creado),
  };
}

/** Origen de escritura/read CRM alineado con FK en `chat_contacts.crm_prospecto_id`. */
export async function resolveCrmProspectosSchemaForTenant(
  pg: PgQueryable,
  tenantChatSchemaRaw: string
): Promise<{ crmSchema: string; source: "fk_chat_contacts" | "table_in_tenant" | "zentra_erp_template" } | null> {
  const tenantChatSchema = assertAllowedChatDataSchema(tenantChatSchemaRaw);

  const fk = await pg.query<{ ref_ns: string }>(
    `SELECT rn.nspname::text AS ref_ns
     FROM pg_constraint c
     JOIN pg_class cf ON cf.oid = c.conrelid
     JOIN pg_namespace tn ON tn.oid = cf.relnamespace
     JOIN pg_attribute a ON a.attrelid = cf.oid AND a.attnum = ANY (c.conkey) AND NOT a.attisdropped
     JOIN pg_class rt ON rt.oid = c.confrelid
     JOIN pg_namespace rn ON rn.oid = rt.relnamespace
     WHERE c.contype = 'f'
       AND tn.nspname::text = $1
       AND cf.relname = 'chat_contacts'
       AND a.attname = 'crm_prospecto_id'
       AND rt.relname = 'crm_prospectos'
     LIMIT 1`,
    [tenantChatSchema]
  );
  const refNsRaw = fk.rows[0]?.ref_ns?.trim();
  if (refNsRaw) {
    try {
      const crmSch = assertAllowedChatDataSchema(refNsRaw);
      return { crmSchema: crmSch, source: "fk_chat_contacts" };
    } catch {
      return null;
    }
  }

  const hasLocal = await pg.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables t
       WHERE t.table_schema = $1 AND t.table_type = 'BASE TABLE' AND t.table_name = 'crm_prospectos'
     ) AS ok`,
    [tenantChatSchema]
  );
  if (hasLocal.rows[0]?.ok) {
    return { crmSchema: tenantChatSchema, source: "table_in_tenant" };
  }

  const app = assertAllowedChatDataSchema(SUPABASE_APP_SCHEMA);
  const hasZen = await pg.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables t
       WHERE t.table_schema = $1 AND t.table_type = 'BASE TABLE' AND t.table_name = 'crm_prospectos'
     ) AS ok`,
    [app]
  );
  if (hasZen.rows[0]?.ok) {
    return { crmSchema: app, source: "zentra_erp_template" };
  }

  console.warn(LOG_LIST, "sin_crm_prospectos", { tenant_chat_schema: tenantChatSchema });
  return null;
}

/** Lista prospectos + notas (misma forma que `listProspectosForEmpresa`). */
export async function listProspectosForEmpresaPg(
  pool: Pool,
  tenantDataSchema: string,
  empresaId: string
): Promise<Prospecto[] | null> {
  const resolved = await resolveCrmProspectosSchemaForTenant(pool, tenantDataSchema);
  if (!resolved) return null;

  const sch = assertAllowedChatDataSchema(resolved.crmSchema);
  const cp = quoteSchemaTable(sch, "crm_prospectos");
  const cn = quoteSchemaTable(sch, "crm_notas");

  console.info(LOG_LIST, "start", {
    empresa_id: empresaId,
    data_schema: tenantDataSchema,
    crm_schema: sch,
    resolved_via: resolved.source,
  });

  try {
    const pr = await pool.query(
      `SELECT *
       FROM ${cp}
       WHERE empresa_id = $1::uuid
       ORDER BY fecha_creacion DESC NULLS LAST`,
      [empresaId]
    );
    const prospectos = (pr.rows ?? []) as ProspectoRowPg[];
    if (prospectos.length === 0) {
      console.info(LOG_LIST, "empty", { empresa_id: empresaId, crm_schema: sch });
      return [];
    }
    const ids = prospectos.map((p) => String(p.id));
    const nt = await pool.query(
      `SELECT *
       FROM ${cn}
       WHERE empresa_id = $1::uuid AND prospecto_id = ANY($2::uuid[])
       ORDER BY fecha DESC NULLS LAST`,
      [empresaId, ids]
    );
    const notasRows = (nt.rows ?? []) as ProspectoRowPg[];
    const notasPorProspecto = notasRows.reduce<Record<string, Nota[]>>((acc, n) => {
      const pid = String(n.prospecto_id ?? "");
      if (!pid) return acc;
      if (!acc[pid]) acc[pid] = [];
      acc[pid].unshift(rowToNotaPg(n));
      return acc;
    }, {});

    const out = prospectos.map((p) =>
      rowToProspectoPg(p, notasPorProspecto[String(p.id ?? "")] ?? [])
    );
    console.info(LOG_LIST, "ok", {
      empresa_id: empresaId,
      crm_schema: sch,
      prospectos: out.length,
      notas: notasRows.length,
    });
    return out;
  } catch (e) {
    console.error(LOG_LIST, "error", e instanceof Error ? e.message : e);
    return null;
  }
}

export async function getProspectoForEmpresaPg(
  pool: Pool,
  tenantDataSchema: string,
  empresaId: string,
  prospectoId: string
): Promise<Prospecto | null> {
  const resolved = await resolveCrmProspectosSchemaForTenant(pool, tenantDataSchema);
  if (!resolved) return null;

  const sch = assertAllowedChatDataSchema(resolved.crmSchema);
  const cp = quoteSchemaTable(sch, "crm_prospectos");
  const cn = quoteSchemaTable(sch, "crm_notas");

  try {
    const pr = await pool.query(
      `SELECT * FROM ${cp}
       WHERE id = $1::uuid AND empresa_id = $2::uuid
       LIMIT 1`,
      [prospectoId, empresaId]
    );
    const row = pr.rows[0] as ProspectoRowPg | undefined;
    if (!row) return null;

    const nt = await pool.query(
      `SELECT * FROM ${cn}
       WHERE empresa_id = $1::uuid AND prospecto_id = $2::uuid
       ORDER BY fecha DESC NULLS LAST`,
      [empresaId, prospectoId]
    );
    const notas = ((nt.rows ?? []) as ProspectoRowPg[]).map(rowToNotaPg);
    return rowToProspectoPg(row, notas);
  } catch (e) {
    console.error("[crm-prospectos-pg] get:", e instanceof Error ? e.message : e);
    return null;
  }
}

async function fetchNextNumeroControlPg(
  pg: PgQueryable,
  crmSchema: string,
  empresaId: string
): Promise<string> {
  const sch = assertAllowedChatDataSchema(crmSchema);
  const cp = quoteSchemaTable(sch, "crm_prospectos");
  const r = await pg.query<{ numero_control: string | null }>(
    `SELECT numero_control::text AS numero_control
     FROM ${cp}
     WHERE empresa_id = $1::uuid
     ORDER BY created_at DESC NULLS LAST
     LIMIT 1`,
    [empresaId]
  );
  return nextNumeroControlFromLast(r.rows[0]?.numero_control);
}

export async function insertProspectoForEmpresaPg(
  pool: Pool,
  tenantDataSchema: string,
  input: {
    empresa_id: string;
    empresa: string;
    contacto: string;
    email: string | null;
    telefono: string | null;
    servicio: string;
    valor_estimado: number;
    etapa: string;
    proxima_accion: string | null;
    fecha_proxima_accion: string | null;
    creado_por: string | null;
    origen_creacion: string;
    origen_detalle: string | null;
    responsable: string | null;
    observaciones: string | null;
  }
): Promise<{ id: string } | null> {
  const resolved = await resolveCrmProspectosSchemaForTenant(pool, tenantDataSchema);
  if (!resolved) return null;
  const sch = assertAllowedChatDataSchema(resolved.crmSchema);
  const cp = quoteSchemaTable(sch, "crm_prospectos");

  const numeroControl = await fetchNextNumeroControlPg(pool, sch, input.empresa_id);

  try {
    const ins = await pool.query(
      `INSERT INTO ${cp} (
         empresa_id, numero_control, empresa, contacto, email, telefono,
         servicio, valor_estimado, etapa, proxima_accion, fecha_proxima_accion,
         creado_por, origen_creacion, origen_detalle, responsable, observaciones
       ) VALUES (
         $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text,
         $7::text, $8::numeric, $9::text, $10::text, $11::date,
         $12::text, $13::text, $14::text, $15::text, $16::text
       )
       RETURNING id::text`,
      [
        input.empresa_id,
        numeroControl,
        input.empresa,
        input.contacto,
        input.email,
        input.telefono,
        input.servicio,
        input.valor_estimado,
        input.etapa,
        input.proxima_accion,
        input.fecha_proxima_accion,
        input.creado_por,
        input.origen_creacion,
        input.origen_detalle,
        input.responsable,
        input.observaciones,
      ]
    );
    const id = (ins.rows[0] as { id?: string } | undefined)?.id;
    return id ? { id } : null;
  } catch (e) {
    console.error("[crm-prospectos-pg] insert:", e instanceof Error ? e.message : e);
    return null;
  }
}

export async function updateProspectoForEmpresaPg(
  pool: Pool,
  tenantDataSchema: string,
  empresaId: string,
  prospectoId: string,
  patch: Record<string, unknown>
): Promise<boolean> {
  const resolved = await resolveCrmProspectosSchemaForTenant(pool, tenantDataSchema);
  if (!resolved) return false;
  const sch = assertAllowedChatDataSchema(resolved.crmSchema);
  const cp = quoteSchemaTable(sch, "crm_prospectos");

  const parts: string[] = [];
  const vals: unknown[] = [];
  let n = 1;
  const push = (col: string, v: unknown) => {
    parts.push(`${col} = $${n}`);
    vals.push(v);
    n += 1;
  };

  if (typeof patch.empresa === "string") push("empresa", patch.empresa.trim());
  if (typeof patch.contacto === "string") push("contacto", patch.contacto.trim());
  if (Object.prototype.hasOwnProperty.call(patch, "email")) {
    push(
      "email",
      typeof patch.email === "string" && patch.email.trim()
        ? patch.email.trim().toLowerCase()
        : null
    );
  }
  if (Object.prototype.hasOwnProperty.call(patch, "telefono")) {
    push(
      "telefono",
      typeof patch.telefono === "string" && patch.telefono.trim() ? patch.telefono.trim() : null
    );
  }
  if (typeof patch.servicio === "string") push("servicio", patch.servicio.trim());
  if (Object.prototype.hasOwnProperty.call(patch, "valor_estimado")) {
    push(
      "valor_estimado",
      typeof patch.valor_estimado === "number"
        ? patch.valor_estimado
        : Number(patch.valor_estimado) || 0
    );
  }
  if (typeof patch.etapa === "string" && patch.etapa.trim()) push("etapa", patch.etapa.trim());
  if (Object.prototype.hasOwnProperty.call(patch, "proxima_accion")) {
    push(
      "proxima_accion",
      typeof patch.proxima_accion === "string" && patch.proxima_accion.trim()
        ? patch.proxima_accion.trim()
        : null
    );
  }
  if (Object.prototype.hasOwnProperty.call(patch, "fecha_proxima_accion")) {
    push(
      "fecha_proxima_accion",
      typeof patch.fecha_proxima_accion === "string" && patch.fecha_proxima_accion.trim()
        ? patch.fecha_proxima_accion.trim()
        : null
    );
  }
  if (Object.prototype.hasOwnProperty.call(patch, "responsable")) {
    push(
      "responsable",
      typeof patch.responsable === "string" && patch.responsable.trim()
        ? patch.responsable.trim()
        : null
    );
  }
  if (Object.prototype.hasOwnProperty.call(patch, "observaciones")) {
    push(
      "observaciones",
      typeof patch.observaciones === "string" && patch.observaciones.trim()
        ? patch.observaciones.trim()
        : null
    );
  }
  if (Object.prototype.hasOwnProperty.call(patch, "cliente_creado")) {
    push("cliente_creado", Boolean(patch.cliente_creado));
  }
  if (typeof patch.fecha_actualizacion === "string" && patch.fecha_actualizacion.trim()) {
    push("fecha_actualizacion", patch.fecha_actualizacion.trim());
  }

  if (parts.length === 0) return true;

  vals.push(prospectoId, empresaId);
  const idPh = n;
  const empPh = n + 1;
  try {
    const r = await pool.query(
      `UPDATE ${cp} SET ${parts.join(", ")}
       WHERE id = $${idPh}::uuid AND empresa_id = $${empPh}::uuid`,
      vals
    );
    return (r.rowCount ?? 0) > 0;
  } catch (e) {
    console.error("[crm-prospectos-pg] update:", e instanceof Error ? e.message : e);
    return false;
  }
}

export async function deleteProspectoForEmpresaPg(
  pool: Pool,
  tenantDataSchema: string,
  empresaId: string,
  prospectoId: string
): Promise<boolean> {
  const resolved = await resolveCrmProspectosSchemaForTenant(pool, tenantDataSchema);
  if (!resolved) return false;
  const sch = assertAllowedChatDataSchema(resolved.crmSchema);
  const cp = quoteSchemaTable(sch, "crm_prospectos");

  try {
    const r = await pool.query(
      `DELETE FROM ${cp} WHERE id = $1::uuid AND empresa_id = $2::uuid`,
      [prospectoId, empresaId]
    );
    return (r.rowCount ?? 0) > 0;
  } catch (e) {
    console.error("[crm-prospectos-pg] delete:", e instanceof Error ? e.message : e);
    return false;
  }
}

export async function prospectoExistsForEmpresaPg(
  pool: Pool,
  tenantDataSchema: string,
  empresaId: string,
  prospectoId: string
): Promise<boolean> {
  const resolved = await resolveCrmProspectosSchemaForTenant(pool, tenantDataSchema);
  if (!resolved) return false;
  const sch = assertAllowedChatDataSchema(resolved.crmSchema);
  const cp = quoteSchemaTable(sch, "crm_prospectos");
  try {
    const r = await pool.query(
      `SELECT 1 FROM ${cp} WHERE id = $1::uuid AND empresa_id = $2::uuid LIMIT 1`,
      [prospectoId, empresaId]
    );
    return (r.rows?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

const LOG_BOARD = "[crm-funnel]";

/**
 * Schemas tenant clonados suelen tener `crm_etapas` vacío: el funnel no renderiza columnas
 * aunque `crm_prospectos.etapa` tenga text (p. ej. LEAD). Idempotente; el catálogo maestro sigue siendo `crm_etapas`.
 */
export async function ensureDefaultCrmEtapasForCrmSchemaClient(
  client: PoolClient,
  crmSchema: string,
  empresaId: string
): Promise<{ inserted: boolean }> {
  const sch = assertAllowedChatDataSchema(crmSchema);
  const ce = quoteSchemaTable(sch, "crm_etapas");
  try {
    const cnt = await client.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM ${ce} WHERE empresa_id = $1::uuid`,
      [empresaId]
    );
    if (Number(cnt.rows[0]?.n) > 0) return { inserted: false };

    await client.query(
      `INSERT INTO ${ce} (empresa_id, codigo, nombre, color, orden, activo)
       SELECT $1::uuid, v.codigo, v.nombre, v.color, v.orden, true
       FROM (VALUES
         ${sqlCrmEtapasDefaultsValuesBlock()}
       ) AS v(codigo, nombre, color, orden)
       ON CONFLICT (empresa_id, codigo) DO NOTHING`,
      [empresaId]
    );
    console.info(LOG_BOARD, "crm_etapas_seed_defaults_client", {
      empresa_id: empresaId,
      crm_schema: sch,
    });
    return { inserted: true };
  } catch (e) {
    console.warn(LOG_BOARD, "crm_etapas_seed_defaults_client_failed", {
      empresa_id: empresaId,
      crm_schema: sch,
      error: e instanceof Error ? e.message : e,
    });
    return { inserted: false };
  }
}

/** Misma semántica que `ensureDefaultCrmEtapasForCrmSchemaClient` para rutas API (pool). */
export async function ensureDefaultCrmEtapasPg(
  pool: Pool,
  tenantDataSchema: string,
  empresaId: string
): Promise<boolean> {
  const resolved = await resolveCrmProspectosSchemaForTenant(pool, tenantDataSchema);
  if (!resolved) return false;
  const sch = assertAllowedChatDataSchema(resolved.crmSchema);
  const ce = quoteSchemaTable(sch, "crm_etapas");
  try {
    const cnt = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM ${ce} WHERE empresa_id = $1::uuid`,
      [empresaId]
    );
    if (Number(cnt.rows[0]?.n) > 0) return false;

    await pool.query(
      `INSERT INTO ${ce} (empresa_id, codigo, nombre, color, orden, activo)
       SELECT $1::uuid, v.codigo, v.nombre, v.color, v.orden, true
       FROM (VALUES
         ${sqlCrmEtapasDefaultsValuesBlock()}
       ) AS v(codigo, nombre, color, orden)
       ON CONFLICT (empresa_id, codigo) DO NOTHING`,
      [empresaId]
    );
    console.info(LOG_BOARD, "crm_etapas_seed_defaults_pg", {
      empresa_id: empresaId,
      data_schema: tenantDataSchema,
      crm_schema: sch,
    });
    return true;
  } catch (e) {
    console.warn(LOG_BOARD, "crm_etapas_seed_defaults_pg_failed", {
      empresa_id: empresaId,
      error: e instanceof Error ? e.message : e,
    });
    return false;
  }
}

/** Logs diagnóstico: prospectos vs etapas activas (match Kanban). */
export async function logCrmFunnelProspectStageMatch(
  pool: Pool | null,
  tenantDataSchema: string | undefined,
  empresaId: string,
  prospectos: Prospecto[],
  modo: string
): Promise<void> {
  const dist: Record<string, number> = {};
  for (const p of prospectos) {
    const k = normalizeEtapaCodigo(p.etapa);
    const key = k || "(vacío)";
    dist[key] = (dist[key] ?? 0) + 1;
  }

  let codigosActivos: string[] = [];
  if (pool && tenantDataSchema) {
    const resolved = await resolveCrmProspectosSchemaForTenant(pool, tenantDataSchema);
    if (resolved) {
      const sch = assertAllowedChatDataSchema(resolved.crmSchema);
      const ce = quoteSchemaTable(sch, "crm_etapas");
      try {
        const r = await pool.query<{ codigo: string }>(
          `SELECT codigo::text FROM ${ce}
           WHERE empresa_id = $1::uuid AND activo = true`,
          [empresaId]
        );
        codigosActivos = (r.rows ?? []).map((x) => normalizeEtapaCodigo(x.codigo));
      } catch {
        codigosActivos = [];
      }
    }
  }

  const activoSet = new Set(codigosActivos);
  let sinColumna = 0;
  if (activoSet.size > 0) {
    for (const p of prospectos) {
      const e = normalizeEtapaCodigo(p.etapa);
      if (!e || !activoSet.has(e)) sinColumna += 1;
    }
  }

  console.info("[crm-funnel][prospect-stage-match]", {
    empresa_id: empresaId,
    data_schema: tenantDataSchema ?? "",
    modo,
    prospectos: prospectos.length,
    etapas_activas: codigosActivos.length,
    distribucion_etapa_en_prospecto: dist,
    prospectos_sin_columna_kanban: sinColumna,
  });
}

/** Etapas activas en el mismo schema CRM que prospectos (`crm_etapas`). */
export async function listCrmEtapasActivasPg(
  pool: Pool,
  tenantDataSchema: string,
  empresaId: string
): Promise<Record<string, unknown>[] | null> {
  const resolved = await resolveCrmProspectosSchemaForTenant(pool, tenantDataSchema);
  if (!resolved) return null;
  const sch = assertAllowedChatDataSchema(resolved.crmSchema);
  const ce = quoteSchemaTable(sch, "crm_etapas");
  try {
    const r = await pool.query(
      `SELECT *
       FROM ${ce}
       WHERE empresa_id = $1::uuid AND activo = true
       ORDER BY orden ASC NULLS LAST`,
      [empresaId]
    );
    return (r.rows ?? []) as Record<string, unknown>[];
  } catch (e) {
    console.error("[crm-prospectos-pg] etapas:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Todas las etapas (activas e inactivas) — Configuración CRM, misma fuente que el Kanban. */
export async function listCrmEtapasTodasPg(
  pool: Pool,
  tenantDataSchema: string,
  empresaId: string
): Promise<Record<string, unknown>[] | null> {
  const resolved = await resolveCrmProspectosSchemaForTenant(pool, tenantDataSchema);
  if (!resolved) return null;
  const sch = assertAllowedChatDataSchema(resolved.crmSchema);
  const ce = quoteSchemaTable(sch, "crm_etapas");
  try {
    const r = await pool.query(
      `SELECT *
       FROM ${ce}
       WHERE empresa_id = $1::uuid
       ORDER BY orden ASC NULLS LAST, codigo ASC`,
      [empresaId]
    );
    return (r.rows ?? []) as Record<string, unknown>[];
  } catch (e) {
    console.error("[crm-prospectos-pg] etapas_todas:", e instanceof Error ? e.message : e);
    return null;
  }
}

