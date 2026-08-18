import { NextRequest } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { buildXlsxBuffer, xlsxResponseHeaders, nowStamp } from "@/lib/excel/export";
import {
  listProveedores,
  listCategoriasMin,
  listRelaciones,
} from "@/lib/proveedores/server/proveedores-pg";

interface Row {
  razon_social_nombre: string;
  nombre_comercial: string;
  ruc: string;
  telefono: string;
  email: string;
  direccion: string;
  contacto: string;
  rubros: string;
  observaciones: string;
  activo: string;
}

export async function GET(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const empresaId = ctx.auth.empresa_id;
  const schema = await fetchDataSchemaForEmpresaId(empresaId);

  try {
    // Serializado para no agotar pool
    const provs = await listProveedores(schema, empresaId);
    const cats = await listCategoriasMin(schema, empresaId);
    const rels = await listRelaciones(schema, empresaId);

    const catById = new Map(cats.map((c) => [c.id, c.nombre]));
    const rubrosByProv = new Map<string, string[]>();
    for (const r of rels) {
      const nombre = catById.get(r.categoria_id);
      if (!nombre) continue;
      const list = rubrosByProv.get(r.proveedor_id) ?? [];
      list.push(nombre);
      rubrosByProv.set(r.proveedor_id, list);
    }

    const rows: Row[] = provs.map((p) => ({
      razon_social_nombre: p.nombre,
      nombre_comercial: p.nombre_comercial ?? "",
      ruc: p.ruc ?? "",
      telefono: p.telefono ?? "",
      email: p.email ?? "",
      direccion: p.direccion ?? "",
      contacto: p.contacto ?? "",
      rubros: (rubrosByProv.get(p.id) ?? []).join(", "),
      observaciones: p.observaciones ?? "",
      activo: p.estado === "inactivo" ? "NO" : "SI",
    }));

    const buf = buildXlsxBuffer<Row>(rows, [
      { header: "RAZON_SOCIAL_NOMBRE", value: (r) => r.razon_social_nombre, width: 38 },
      { header: "NOMBRE_COMERCIAL", value: (r) => r.nombre_comercial, width: 30 },
      { header: "RUC", value: (r) => r.ruc, width: 16 },
      { header: "TELEFONO", value: (r) => r.telefono, width: 16 },
      { header: "EMAIL", value: (r) => r.email, width: 26 },
      { header: "DIRECCION", value: (r) => r.direccion, width: 32 },
      { header: "CONTACTO", value: (r) => r.contacto, width: 22 },
      { header: "RUBROS", value: (r) => r.rubros, width: 32 },
      { header: "OBSERVACIONES", value: (r) => r.observaciones, width: 32 },
      { header: "ACTIVO", value: (r) => r.activo, width: 8 },
    ], { sheetName: "Proveedores" });

    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: xlsxResponseHeaders(`proveedores-${nowStamp()}`),
    });
  } catch (err) {
    console.error("[/api/proveedores/export]", err instanceof Error ? err.message : err);
    return new Response("No se pudo generar el Excel", { status: 500 });
  }
}
