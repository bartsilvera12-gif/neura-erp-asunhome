import type pg from "pg";
import { randomUUID } from "crypto";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";

const VALID_INSERT_NODE_TYPES = [
  "text",
  "buttons",
  "list",
  "media",
  "image_input",
  "human",
  "end",
] as const;

export type InsertFlowNodeBetweenNewNode = {
  node_code: string;
  node_type: string;
  message_text?: string | null;
  save_as_field?: string | null;
  is_active?: boolean;
  crm_action_type?: string | null;
  crm_action_config?: Record<string, unknown> | null;
};

export type InsertFlowNodeBetweenParams = {
  empresaId: string;
  flowCode: string;
  sourceType: "node" | "option";
  /** node_code del chat_flow_nodes fuente (padre de la opción si sourceType === option). */
  sourceNodeCode: string;
  /** UUID de chat_flow_options cuando sourceType === option */
  sourceOptionId?: string;
  newNode: InsertFlowNodeBetweenNewNode;
};

export type InsertFlowNodeBetweenResult = {
  newNodeId: string;
  newNodeCode: string;
  previousNextNodeCode: string | null;
  /** next_node_code del nuevo nodo (= previousNext) */
  wiredTo: string | null;
};

function validateNewNodeCode(code: string): void {
  const c = code.trim();
  if (!c) throw new Error("node_code requerido");
  if (!/^[a-zA-Z0-9_-]+$/.test(c)) {
    throw new Error("node_code solo puede tener letras, números, guion y guion bajo");
  }
}

function validateNodeType(nt: string): void {
  const t = nt.trim();
  if (!VALID_INSERT_NODE_TYPES.includes(t as (typeof VALID_INSERT_NODE_TYPES)[number])) {
    throw new Error(`node_type inválido para inserción: ${t}`);
  }
}

/**
 * Inserción atómica vía Postgres (BEGIN/COMMIT).
 */
export async function insertFlowNodeBetweenTransactionalPg(
  pool: pg.Pool,
  schemaRaw: string,
  params: InsertFlowNodeBetweenParams
): Promise<InsertFlowNodeBetweenResult> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  validateNewNodeCode(params.newNode.node_code);
  validateNodeType(params.newNode.node_type);

  const fc = params.flowCode.trim();
  if (!fc) throw new Error("flow_code requerido");

  const srcNode = params.sourceNodeCode.trim();
  if (!srcNode) throw new Error("sourceNodeCode requerido");

  if (params.sourceType === "option") {
    const oid = params.sourceOptionId?.trim();
    if (!oid) throw new Error("sourceOptionId requerido para sourceType option");
  }

  const nodesT = quoteSchemaTable(schema, "chat_flow_nodes");
  const optsT = quoteSchemaTable(schema, "chat_flow_options");

  const empresaId = params.empresaId;
  const newCode = params.newNode.node_code.trim();
  const nt = params.newNode.node_type.trim();
  const msg = params.newNode.message_text ?? null;
  const saveAs = params.newNode.save_as_field?.trim() || null;
  const isActive = params.newNode.is_active !== false;
  const crmType = params.newNode.crm_action_type?.trim() || null;
  const crmCfg = JSON.stringify(params.newNode.crm_action_config ?? {});

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const maxRow = await client.query(
      `SELECT COALESCE(MAX(sort_order), 0)::int AS m FROM ${nodesT}
       WHERE empresa_id = $1::uuid AND flow_code = $2`,
      [empresaId, fc]
    );
    const sortOrder = Number(maxRow.rows[0]?.m ?? 0) + 1;

    const dup = await client.query(
      `SELECT 1 FROM ${nodesT}
       WHERE empresa_id = $1::uuid AND flow_code = $2 AND node_code = $3 LIMIT 1`,
      [empresaId, fc, newCode]
    );
    if (dup.rows.length > 0) {
      throw new Error(`Ya existe un paso con el código «${newCode}» en este flujo`);
    }

    let oldNext: string | null = null;

    if (params.sourceType === "node") {
      const nr = await client.query(
        `SELECT next_node_code, node_type FROM ${nodesT}
         WHERE empresa_id = $1::uuid AND flow_code = $2 AND node_code = $3`,
        [empresaId, fc, srcNode]
      );
      if (nr.rows.length === 0) throw new Error("Nodo fuente no encontrado");
      const nodeType = String(nr.rows[0].node_type ?? "");
      if (nodeType === "buttons" || nodeType === "list") {
        throw new Error(
          "Este paso usa botones o lista: insertá el nuevo paso desde la opción concreta («Insertar después» en la fila del botón/opción), no desde el paso completo."
        );
      }
      const raw = nr.rows[0].next_node_code;
      oldNext = typeof raw === "string" && raw.trim() ? raw.trim() : null;
    } else {
      const oid = params.sourceOptionId!.trim();
      const orow = await client.query(
        `SELECT o.next_node_code AS opt_next
         FROM ${optsT} o
         INNER JOIN ${nodesT} n ON n.id = o.node_id
         WHERE o.id = $1::uuid
           AND n.empresa_id = $2::uuid
           AND n.flow_code = $3
           AND n.node_code = $4`,
        [oid, empresaId, fc, srcNode]
      );
      if (orow.rows.length === 0) {
        throw new Error("Opción no encontrada o no pertenece al paso indicado");
      }
      const raw = orow.rows[0].opt_next;
      oldNext = typeof raw === "string" && raw.trim() ? raw.trim() : null;
    }

    const newId = randomUUID();

    await client.query(
      `INSERT INTO ${nodesT} (
        id, empresa_id, flow_code, node_code, message_text, node_type,
        save_as_field, next_node_code, sort_order, is_active,
        crm_action_type, crm_action_config
      ) VALUES (
        $1::uuid, $2::uuid, $3, $4, $5, $6,
        $7, $8, $9, $10,
        $11, $12::jsonb
      )`,
      [
        newId,
        empresaId,
        fc,
        newCode,
        msg,
        nt,
        saveAs,
        oldNext,
        sortOrder,
        isActive,
        crmType,
        crmCfg,
      ]
    );

    if (params.sourceType === "node") {
      const up = await client.query(
        `UPDATE ${nodesT} SET next_node_code = $1
         WHERE empresa_id = $2::uuid AND flow_code = $3 AND node_code = $4`,
        [newCode, empresaId, fc, srcNode]
      );
      if (up.rowCount === 0) throw new Error("No se pudo actualizar el paso fuente");
    } else {
      const up = await client.query(`UPDATE ${optsT} SET next_node_code = $1 WHERE id = $2::uuid`, [
        newCode,
        params.sourceOptionId!.trim(),
      ]);
      if (up.rowCount === 0) throw new Error("No se pudo actualizar la opción");
    }

    await client.query("COMMIT");

    return {
      newNodeId: newId,
      newNodeCode: newCode,
      previousNextNodeCode: oldNext,
      wiredTo: oldNext,
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Fallback sin transacción binaria: insert + update; si falla el update, borra el nodo creado.
 */
export async function insertFlowNodeBetweenBestEffortSupabase(
  supabase: AppSupabaseClient,
  params: InsertFlowNodeBetweenParams
): Promise<InsertFlowNodeBetweenResult> {
  validateNewNodeCode(params.newNode.node_code);
  validateNodeType(params.newNode.node_type);

  const fc = params.flowCode.trim();
  const empresaId = params.empresaId;
  const srcNode = params.sourceNodeCode.trim();
  const newCode = params.newNode.node_code.trim();

  let oldNext: string | null = null;

  if (params.sourceType === "node") {
    const { data: row, error } = await supabase
      .from("chat_flow_nodes")
      .select("next_node_code, node_type")
      .eq("empresa_id", empresaId)
      .eq("flow_code", fc)
      .eq("node_code", srcNode)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Nodo fuente no encontrado");
    const ntype = String((row as { node_type?: string }).node_type ?? "");
    if (ntype === "buttons" || ntype === "list") {
      throw new Error(
        "Este paso usa botones o lista: insertá desde la opción concreta, no desde el paso completo."
      );
    }
    const nn = (row as { next_node_code?: string | null }).next_node_code;
    oldNext = typeof nn === "string" && nn.trim() ? nn.trim() : null;
  } else {
    const oid = params.sourceOptionId?.trim();
    if (!oid) throw new Error("sourceOptionId requerido");

    const { data: parent, error: pErr } = await supabase
      .from("chat_flow_nodes")
      .select("id")
      .eq("empresa_id", empresaId)
      .eq("flow_code", fc)
      .eq("node_code", srcNode)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    const parentId = (parent as { id?: string } | null)?.id;
    if (!parentId) throw new Error("Nodo padre no encontrado");

    const { data: opt, error: oErr } = await supabase
      .from("chat_flow_options")
      .select("next_node_code")
      .eq("id", oid)
      .eq("node_id", parentId)
      .maybeSingle();
    if (oErr) throw new Error(oErr.message);
    if (!opt) throw new Error("Opción no encontrada");
    const nn = (opt as { next_node_code?: string | null }).next_node_code;
    oldNext = typeof nn === "string" && nn.trim() ? nn.trim() : null;
  }

  const { data: lastNode } = await supabase
    .from("chat_flow_nodes")
    .select("sort_order")
    .eq("empresa_id", empresaId)
    .eq("flow_code", fc)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sortOrder =
    typeof (lastNode as { sort_order?: number } | null)?.sort_order === "number"
      ? ((lastNode as { sort_order: number }).sort_order ?? 0) + 1
      : 1;

  const { data: inserted, error: insErr } = await supabase
    .from("chat_flow_nodes")
    .insert({
      empresa_id: empresaId,
      flow_code: fc,
      node_code: newCode,
      node_type: params.newNode.node_type.trim(),
      message_text: params.newNode.message_text ?? null,
      save_as_field: params.newNode.save_as_field?.trim() || null,
      next_node_code: oldNext,
      sort_order: sortOrder,
      is_active: params.newNode.is_active !== false,
      crm_action_type: params.newNode.crm_action_type?.trim() || null,
      crm_action_config:
        typeof params.newNode.crm_action_config === "object" && params.newNode.crm_action_config
          ? params.newNode.crm_action_config
          : {},
    })
    .select("id")
    .single();

  if (insErr || !inserted) {
    throw new Error(insErr?.message ?? "No se pudo crear el paso");
  }

  const newId = String((inserted as { id: string }).id);

  try {
    if (params.sourceType === "node") {
      const { error: uErr } = await supabase
        .from("chat_flow_nodes")
        .update({ next_node_code: newCode })
        .eq("empresa_id", empresaId)
        .eq("flow_code", fc)
        .eq("node_code", srcNode);
      if (uErr) throw new Error(uErr.message);
    } else {
      const { error: uErr } = await supabase
        .from("chat_flow_options")
        .update({ next_node_code: newCode })
        .eq("id", params.sourceOptionId!.trim());
      if (uErr) throw new Error(uErr.message);
    }
  } catch (e) {
    await supabase.from("chat_flow_nodes").delete().eq("id", newId).eq("empresa_id", empresaId);
    throw e;
  }

  return {
    newNodeId: newId,
    newNodeCode: newCode,
    previousNextNodeCode: oldNext,
    wiredTo: oldNext,
  };
}

/**
 * Preferís PG transaccional; si no hay pool (dev local), fallback con compensación en Supabase.
 */
export async function insertFlowNodeBetweenAuto(
  pool: ReturnType<typeof getChatPostgresPool>,
  schemaRaw: string,
  params: InsertFlowNodeBetweenParams,
  supabase: AppSupabaseClient
): Promise<InsertFlowNodeBetweenResult> {
  if (pool) {
    return insertFlowNodeBetweenTransactionalPg(pool, schemaRaw, params);
  }
  console.warn(
    "[flow-insert-between] sin pool Postgres: usando fallback Supabase (rollback manual si falla el segundo paso)"
  );
  return insertFlowNodeBetweenBestEffortSupabase(supabase, params);
}
