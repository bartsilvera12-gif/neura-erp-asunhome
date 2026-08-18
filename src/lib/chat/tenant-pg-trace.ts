/** Si `process.env.NEURA_CONV_PG_TRACE === "1", loguea referencias sospechosas de PostgREST en schemas tenant erp_* */
export function logTenantPgTrace(operation: string, meta: Record<string, unknown>): void {
  if (process.env.NEURA_CONV_PG_TRACE !== "1") return;
  console.warn("[NEURA_CONV_PG_TRACE]", operation, meta);
}

/** Log cuando PostgREST devuelve Invalid schema — para ubicar rápido la función llamadora. */
export function logInvalidSchema(operation: string, schema: string | undefined, error: unknown): void {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  const low = msg.toLowerCase();
  if (
    low.includes("invalid schema") ||
    low.includes("pgrst106") ||
    low.includes("schema must be one of") ||
    low.includes("schema debe ser uno de")
  ) {
    console.error("[NEURA_CONV_PG_TRACE_INVALID_SCHEMA]", {
      operation,
      schema,
      message: msg,
      at: new Date().toISOString(),
    });
  }
}
