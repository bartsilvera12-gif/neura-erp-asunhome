// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySb = any;

/**
 * Reemplaza las filas de vistas de dashboard del usuario.
 * Si `defaultDashboardViewId` no está en la lista, se ignora (o se usa la primera si hay una sola).
 */
export async function syncUsuarioDashboardViews(
  supabase: AnySb,
  usuarioId: string,
  dashboardViewIds: string[],
  defaultDashboardViewId: string | null | undefined
): Promise<void> {
  const { error: errDel } = await supabase
    .from("usuario_dashboard_views")
    .delete()
    .eq("usuario_id", usuarioId);
  if (errDel) throw new Error(errDel.message);

  if (dashboardViewIds.length === 0) return;

  let def =
    defaultDashboardViewId != null && defaultDashboardViewId !== ""
      ? String(defaultDashboardViewId)
      : null;
  const uniq = [...new Set(dashboardViewIds)];
  if (def && !uniq.includes(def)) def = null;
  if (!def && uniq.length === 1) def = uniq[0];

  const rows = uniq.map((dashboard_view_id) => ({
    usuario_id: usuarioId,
    dashboard_view_id,
    es_default: def === dashboard_view_id,
  }));

  const { error: errIns } = await supabase.from("usuario_dashboard_views").insert(rows);
  if (errIns) throw new Error(errIns.message);
}
