import type { Pool } from "pg";
import type { SupabaseAdmin } from "@/lib/chat/types";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

/**
 * Shim mínimo PostgREST→Postgres para tablas chat_* / sorteos en schemas tenant no expuestos.
 * Delega `.rpc()` y `.storage` a clientes reales (catálogo / service role).
 */

const ALLOWED_TABLES = new Set([
  "chat_agents",
  "chat_campaign_button_actions",
  "chat_campaign_events",
  "chat_campaign_jobs",
  "chat_campaign_recipients",
  "chat_campaign_templates",
  "chat_campaigns",
  "chat_channels",
  "chat_comprobante_validaciones",
  "chat_contacts",
  "chat_conversations",
  "chat_flow_data",
  "chat_flow_events",
  "chat_flow_node_blocks",
  "chat_flow_nodes",
  "chat_flow_options",
  "chat_flow_sessions",
  "chat_flow_recontact_rules",
  "chat_flow_recontact_runs",
  "chat_flows",
  "chat_messages",
  "chat_queue_channels",
  "chat_queues",
  "chat_routing_events",
  "chat_usuario_omnicanal",
  "sorteo_entradas",
  "sorteo_cupones",
  "sorteo_ticket_deliveries",
  "sorteo_revendedor_clicks",
  "sorteo_revendedores",
  "sorteos",
  "clientes",
  "proyecto_tipos",
  "proyecto_estados",
  "proyectos",
  "proyecto_tareas",
  "proyecto_comentarios",
  "proyecto_archivos",
  "proyecto_estado_historial",
  "marketing_calendarios",
  "marketing_piezas",
  "marketing_comentarios",
  "marketing_historial_estados",
  "empresa_sifen_config",
  "cliente_tipos_servicio_catalogo",
  "suscripciones",
  "cliente_perfil_tributario",
  "planes",
  "facturas",
  "factura_items",
  "pagos",
  "factura_electronica",
  "factura_electronica_evento",
]);

function pgErr(message: string, code?: string): { message: string; code?: string } {
  return code ? { message, code } : { message };
}

type Filter =
  | { k: "eq"; col: string; val: unknown }
  | { k: "neq"; col: string; val: unknown }
  | { k: "is"; col: string; val: unknown }
  /** PostgREST `.not(col, "is", null)` → columna IS NOT NULL */
  | { k: "isNotNull"; col: string }
  | { k: "in"; col: string; val: unknown[] }
  | { k: "ilike"; col: string; val: string }
  | { k: "gte"; col: string; val: unknown }
  | { k: "lte"; col: string; val: unknown };

type Order = { col: string; asc: boolean };

function pushParam(params: unknown[], v: unknown): string {
  params.push(v);
  return `$${params.length}`;
}

export type TenantPgChatSupabaseShimOptions = {
  pool: Pool;
  schema: string;
  /** Storage (chat-media, etc.) — típico: service role sin schema tenant. */
  storageDelegate: SupabaseAdmin;
  /** RPC en `public` / API expuesta — típico: service role catálogo. */
  rpcDelegate: AppSupabaseClient;
};

function serializeCell(col: string, val: unknown, params: unknown[]): string {
  if (val === undefined) return "DEFAULT";
  const lower = col.toLowerCase();
  const jsonbCol =
    lower.includes("node_codes") ||
    lower.includes("payload") ||
    lower.includes("config") ||
    lower.includes("routing_config") ||
    lower === "cupones" ||
    lower.includes("json") ||
    lower.includes("raw_payload") ||
    lower === "brief_data" ||
    lower === "metadata";
  if (jsonbCol) {
    /** Evita "invalid input syntax for type json" al pasar objetos con casting manual ::jsonb */
    let serialized: string;
    try {
      serialized = typeof val === "string" ? val : JSON.stringify(val ?? null);
    } catch {
      serialized = "null";
    }
    const p = pushParam(params, serialized);
    return `${p}::jsonb`;
  }
  const p = pushParam(params, val);
  return p;
}

export function createTenantPgChatSupabaseShim(opts: TenantPgChatSupabaseShimOptions): SupabaseAdmin {
  const schema = assertAllowedChatDataSchema(opts.schema);
  const pool = opts.pool;

  function tableSql(table: string): string {
    if (!ALLOWED_TABLES.has(table)) {
      throw new Error(`[tenant-pg-shim] tabla no permitida: ${table}`);
    }
    return quoteSchemaTable(schema, table);
  }

  class Query implements PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> {
    readonly table: string;
    op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
    cols = "*";
    returningCols?: string;
    selectCountOpts?: { count: "exact"; head?: boolean };
    filters: Filter[] = [];
    orders: Order[] = [];
    lim?: number;
    terminal: "none" | "maybeSingle" | "single" | "array" = "array";
    insertRows?: Record<string, unknown>[];
    updatePatch?: Record<string, unknown>;
    upsertRows?: Record<string, unknown>[];
    upsertConflict?: string;

    constructor(table: string) {
      this.table = table;
    }

    select(columns?: string, opts?: { count: "exact"; head?: boolean }) {
      /** Tras `.update()`, `.select(cols)` significa `RETURNING cols` (PostgREST).
       *  Sin argumentos = `RETURNING *` (paridad con `supabase-js`). */
      if (this.op === "update") {
        this.returningCols = columns != null && columns !== "" ? columns : "*";
        if (opts?.count === "exact") this.selectCountOpts = opts;
        return this;
      }
      if (columns != null && columns !== "") this.cols = columns;
      if (opts?.count === "exact") this.selectCountOpts = opts;
      this.op = "select";
      return this;
    }

    insert(row: Record<string, unknown> | Record<string, unknown>[]) {
      this.op = "insert";
      this.insertRows = Array.isArray(row) ? row : [row];
      return this;
    }

    update(patch: Record<string, unknown>) {
      this.op = "update";
      this.updatePatch = patch;
      return this;
    }

    upsert(rows: Record<string, unknown> | Record<string, unknown>[], opt?: { onConflict?: string }) {
      this.op = "upsert";
      this.upsertRows = Array.isArray(rows) ? rows : [rows];
      this.upsertConflict = opt?.onConflict ?? "";
      return this;
    }

    delete() {
      this.op = "delete";
      return this;
    }

    eq(col: string, val: unknown) {
      this.filters.push({ k: "eq", col, val });
      return this;
    }
    neq(col: string, val: unknown) {
      this.filters.push({ k: "neq", col, val });
      return this;
    }
    is(col: string, val: unknown) {
      this.filters.push({ k: "is", col, val });
      return this;
    }

    /**
     * Subconjunto PostgREST; lo usa `campaign-recipient-resolve` y otras consultas:
     * `.not("sent_at", "is", null)` → `sent_at IS NOT NULL`
     * `.not("x", "eq", v)` → `x <> v`
     */
    not(col: string, op: string, val: unknown) {
      const o = op.trim().toLowerCase();
      if (o === "is" && val === null) {
        this.filters.push({ k: "isNotNull", col });
        return this;
      }
      if (o === "eq") {
        this.filters.push({ k: "neq", col, val });
        return this;
      }
      throw new Error(`[tenant-pg-shim] .not("${col}", "${op}", …) no soportado`);
    }

    in(col: string, val: unknown[]) {
      this.filters.push({ k: "in", col, val });
      return this;
    }
    ilike(col: string, val: string) {
      this.filters.push({ k: "ilike", col, val });
      return this;
    }
    gte(col: string, val: unknown) {
      this.filters.push({ k: "gte", col, val });
      return this;
    }
    lte(col: string, val: unknown) {
      this.filters.push({ k: "lte", col, val });
      return this;
    }

    order(col: string, opts?: { ascending?: boolean }) {
      this.orders.push({ col, asc: opts?.ascending !== false });
      return this;
    }

    limit(n: number) {
      this.lim = n;
      return this;
    }

    maybeSingle() {
      this.terminal = "maybeSingle";
      return this;
    }

    single() {
      this.terminal = "single";
      return this;
    }

    private buildWhere(params: unknown[]): string {
      const t = tableSql(this.table);
      const parts: string[] = [];
      for (const f of this.filters) {
        const col = f.col.trim();
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(col)) throw new Error(`filtro columna inválida: ${col}`);
        const qc = `${t}.${col}`;
        if (f.k === "eq") {
          parts.push(`${qc} = ${pushParam(params, f.val)}`);
        } else if (f.k === "neq") {
          parts.push(`${qc} <> ${pushParam(params, f.val)}`);
        } else         if (f.k === "is") {
          if (f.val === null) parts.push(`${qc} IS NULL`);
          else parts.push(`${qc} IS NOT NULL`);
        } else if (f.k === "isNotNull") {
          parts.push(`${qc} IS NOT NULL`);
        } else if (f.k === "in") {
          const arr = f.val as unknown[];
          if (arr.length === 0) parts.push("FALSE");
          else {
            const qs = arr.map((v) => pushParam(params, v));
            parts.push(`${qc} IN (${qs.join(", ")})`);
          }
        } else if (f.k === "ilike") {
          parts.push(`${qc} ILIKE ${pushParam(params, f.val)}`);
        } else if (f.k === "gte") {
          parts.push(`${qc} >= ${pushParam(params, f.val)}`);
        } else if (f.k === "lte") {
          parts.push(`${qc} <= ${pushParam(params, f.val)}`);
        }
      }
      return parts.length ? `WHERE ${parts.join(" AND ")}` : "";
    }

    private async run(): Promise<{ data: unknown; error: { message: string; code?: string } | null }> {
      const params: unknown[] = [];

      try {
        /** `tableSql` valida que la tabla esté en `ALLOWED_TABLES`. Si no lo está, lanza.
         *  Necesitamos que ese error vuelva como `{ error }` (paridad con PostgREST/supabase-js),
         *  NO como excepción no manejada que derribe el handler con 500. */
        const tsql = tableSql(this.table);
        if (this.op === "select") {
          if (this.selectCountOpts?.count === "exact" && this.selectCountOpts.head) {
            const wh = this.buildWhere(params);
            const q = `SELECT COUNT(*)::bigint AS c FROM ${tsql} ${wh}`;
            const r = await pool.query(q, params);
            const c = r.rows?.[0] as { c?: string } | undefined;
            const n = c?.c != null ? Number(c.c) : 0;
            return { data: null, error: null, count: n } as unknown as {
              data: unknown;
              error: { message: string; code?: string } | null;
            };
          }

          const wh = this.buildWhere(params);
          const ordFix =
            this.orders.length > 0
              ? `ORDER BY ${this.orders
                  .map((o) => `${tsql}.${o.col} ${o.asc ? "ASC" : "DESC"}`)
                  .join(", ")}`
              : "";
          const lim =
            this.terminal === "maybeSingle" || this.terminal === "single"
              ? `LIMIT 1`
              : this.lim != null
                ? `LIMIT ${Math.max(0, Math.floor(this.lim))}`
                : "";

          const q = `SELECT ${this.cols} FROM ${tsql} ${wh} ${ordFix} ${lim}`.replace(/\s+/g, " ").trim();
          const r = await pool.query(q, params);
          const rows = r.rows ?? [];
          if (this.terminal === "maybeSingle") {
            if (rows.length > 1) {
              return { data: null, error: pgErr("múltiples filas para maybeSingle") };
            }
            return { data: rows[0] ?? null, error: null };
          }
          if (this.terminal === "single") {
            if (rows.length !== 1) {
              return { data: null, error: pgErr(rows.length === 0 ? "no rows" : "múltiples filas") };
            }
            return { data: rows[0], error: null };
          }
          return { data: rows, error: null };
        }

        if (this.op === "insert" && this.insertRows?.length) {
          const rows = this.insertRows;
          const cols = Object.keys(rows[0] ?? {});
          if (cols.length === 0) return { data: null, error: pgErr("insert vacío") };

          const allCols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
          const placeholders: string[] = [];
          for (const row of rows) {
            const vals = allCols.map((c) =>
              row[c] === undefined ? "DEFAULT" : serializeCell(c, row[c], params)
            );
            placeholders.push(`(${vals.join(", ")})`);
          }

          let ret = "";
          if (this.returningCols && this.returningCols.length > 0) {
            ret = `RETURNING ${this.returningCols}`;
          }

          const q = `INSERT INTO ${tsql} (${allCols.map((c) => `"${c}"`).join(", ")}) VALUES ${placeholders.join(", ")} ${ret}`.trim();
          try {
            const r = await pool.query(q, params);
            const outRows = r.rows ?? [];
            if (this.terminal === "maybeSingle") {
              return { data: outRows[0] ?? null, error: null };
            }
            if (this.terminal === "single") {
              if (outRows.length !== 1)
                return { data: null, error: pgErr(outRows.length === 0 ? "insert sin fila" : "múltiples filas") };
              return { data: outRows[0], error: null };
            }
            return { data: outRows.length <= 1 ? outRows[0] ?? null : outRows, error: null };
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            const code =
              typeof e === "object" && e !== null && "code" in e ? String((e as { code?: string }).code) : "";
            if (code === "23505" || msg.includes("23505")) {
              return { data: null, error: { message: msg, code: "23505" } };
            }
            return { data: null, error: pgErr(msg) };
          }
        }

        if (this.op === "delete") {
          const wh = this.buildWhere(params);
          if (!wh) {
            return {
              data: null,
              error: pgErr(
                "[tenant-pg-shim] DELETE rechazado sin WHERE (evita borrar toda la tabla)"
              ),
            };
          }
          const q = `DELETE FROM ${tsql} ${wh}`.trim();
          try {
            await pool.query(q, params);
            return { data: null, error: null };
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            return { data: null, error: pgErr(msg) };
          }
        }

        if (this.op === "update" && this.updatePatch) {
          const sets = Object.entries(this.updatePatch).map(([col, val]) => {
            if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(col)) throw new Error(`columna update inválida: ${col}`);
            return `"${col}" = ${serializeCell(col, val, params)}`;
          });
          const wh = this.buildWhere(params);
          const ret =
            this.returningCols != null && String(this.returningCols).trim() !== ""
              ? `RETURNING ${this.returningCols}`
              : "";
          const q = `UPDATE ${tsql} SET ${sets.join(", ")} ${wh} ${ret}`.trim();
          const r = await pool.query(q, params);
          const rows = r.rows ?? [];
          if (!ret) {
            return { data: null, error: null };
          }
          if (this.terminal === "maybeSingle") {
            if (rows.length > 1) {
              return { data: null, error: pgErr("múltiples filas para maybeSingle") };
            }
            return { data: rows[0] ?? null, error: null };
          }
          if (this.terminal === "single") {
            if (rows.length !== 1) {
              return { data: null, error: pgErr(rows.length === 0 ? "no rows" : "múltiples filas") };
            }
            return { data: rows[0], error: null };
          }
          return { data: rows, error: null };
        }

        if (this.op === "upsert" && this.upsertRows?.length && this.upsertConflict) {
          const conflictCols = this.upsertConflict.split(",").map((s) => s.trim());
          const rows = this.upsertRows;
          const allCols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
          const placeholders: string[] = [];
          for (const row of rows) {
            const vals = allCols.map((c) =>
              row[c] === undefined ? "DEFAULT" : serializeCell(c, row[c], params)
            );
            placeholders.push(`(${vals.join(", ")})`);
          }
          const nonConflict = allCols.filter((c) => !conflictCols.includes(c));
          const setParts = nonConflict.map((c) => `"${c}" = EXCLUDED."${c}"`);
          const conflictAction =
            setParts.length > 0 ? `DO UPDATE SET ${setParts.join(", ")}` : `DO NOTHING`;
          const ret =
            this.returningCols && this.returningCols.length > 0
              ? `RETURNING ${this.returningCols}`
              : "";
          const q = `
            INSERT INTO ${tsql} (${allCols.map((c) => `"${c}"`).join(", ")})
            VALUES ${placeholders.join(", ")}
            ON CONFLICT (${conflictCols.map((c) => `"${c}"`).join(", ")})
            ${conflictAction}
            ${ret}
          `.trim();
          try {
            const r = await pool.query(q, params);
            const outRows = r.rows ?? [];
            if (this.returningCols) {
              if (this.terminal === "maybeSingle") {
                return { data: outRows[0] ?? null, error: null };
              }
              if (this.terminal === "single") {
                if (outRows.length !== 1)
                  return { data: null, error: pgErr(outRows.length === 0 ? "upsert sin fila" : "múltiples filas") };
                return { data: outRows[0], error: null };
              }
              return { data: outRows.length <= 1 ? outRows[0] ?? null : outRows, error: null };
            }
            return { data: null, error: null };
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            return { data: null, error: pgErr(msg) };
          }
        }

        return { data: null, error: pgErr("operación shim no soportada") };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { data: null, error: pgErr(msg) };
      }
    }

    then<TResult1 = { data: unknown; error: { message: string; code?: string } | null }, TResult2 = never>(
      onfulfilled?: ((value: { data: unknown; error: { message: string; code?: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ): Promise<TResult1 | TResult2> {
      return this.run().then(onfulfilled, onrejected);
    }
  }

  const shim = {
    from(table: string) {
      const q = new Query(table);
      return {
        select: (columns?: string, opts?: { count: "exact"; head?: boolean }) => q.select(columns, opts),
        insert: (row: Record<string, unknown> | Record<string, unknown>[]) => {
          q.insert(row);
          return Object.assign(q, {
            select: (cols?: string) => {
              q.returningCols = cols != null && cols !== "" ? cols : "*";
              return q;
            },
          });
        },
        update: (patch: Record<string, unknown>) => {
          q.update(patch);
          return q;
        },
        upsert: (rows: Record<string, unknown> | Record<string, unknown>[], opt?: { onConflict?: string }) => {
          q.upsert(rows, opt);
          return Object.assign(q, {
            select: (cols?: string) => {
              q.returningCols = cols != null && cols !== "" ? cols : "*";
              return q;
            },
          });
        },
        delete: () => q.delete(),
        eq: (c: string, v: unknown) => q.eq(c, v),
        neq: (c: string, v: unknown) => q.neq(c, v),
        is: (c: string, v: unknown) => q.is(c, v),
        not: (c: string, op: string, v: unknown) => q.not(c, op, v),
        in: (c: string, v: unknown[]) => q.in(c, v),
        ilike: (c: string, v: string) => q.ilike(c, v),
        gte: (c: string, v: unknown) => q.gte(c, v),
        lte: (c: string, v: unknown) => q.lte(c, v),
        order: (c: string, o?: { ascending?: boolean }) => q.order(c, o),
        limit: (n: number) => q.limit(n),
        maybeSingle: () => q.maybeSingle(),
        single: () => q.single(),
        then: (onF?: never, onR?: never) => q.then(onF as never, onR as never),
      };
    },

    async rpc<T = unknown>(
      fn: string,
      args?: Record<string, unknown>
    ): Promise<{ data: T | null; error: { message: string } | null }> {
      /** Algunas funciones SQL viven en CADA schema tenant (no en `zentra_erp` solo) porque dependen
       *  de tablas locales del schema (p. ej. `<schema>.facturas` + `<schema>.factura_correlativos`).
       *  Delegar al catálogo `zentra_erp` reservaría el correlativo en el schema equivocado.
       *  Para esas, ejecutamos PG directo en `<schema>.<fn>(...)`. */
      if (fn === "next_numero_factura_empresa") {
        try {
          const empresaId = args?.p_empresa_id ?? null;
          const prefijo = args?.p_prefijo_default ?? "FAC-";
          const q = `SELECT "${schema}".next_numero_factura_empresa($1::uuid, $2::text) AS r`;
          const r = await pool.query(q, [empresaId, prefijo]);
          const v = r.rows?.[0]?.r ?? null;
          return { data: v as T, error: null };
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return { data: null, error: { message: msg } };
        }
      }
      return opts.rpcDelegate.rpc(fn, args ?? {}) as unknown as Promise<{
        data: T | null;
        error: { message: string } | null;
      }>;
    },

    get storage() {
      return opts.storageDelegate.storage;
    },
  };

  return shim as unknown as SupabaseAdmin;
}
