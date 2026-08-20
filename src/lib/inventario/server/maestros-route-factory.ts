/**
 * Handlers CRUD compartidos por /api/marcas y /api/lineas-producto.
 *
 * Las dos rutas son idénticas salvo la tabla, así que se generan desde acá en
 * vez de duplicar el archivo.
 */
import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  listMaestro,
  insertMaestro,
  updateMaestro,
  deleteMaestro,
  type MaestroTabla,
} from "./maestros-pg";

function txt(v: unknown, max: number): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max) : null;
}
function uuidOrNull(v: unknown): string | null {
  return typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v.trim()) ? v.trim() : null;
}

export function makeMaestroHandlers(tabla: MaestroTabla, etiqueta: string) {
  async function ctxOf(request: NextRequest) {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return null;
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    return { empresaId: ctx.auth.empresa_id, schema };
  }

  return {
    async GET(request: NextRequest) {
      try {
        const c = await ctxOf(request);
        if (!c) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
        const todas = new URL(request.url).searchParams.get("todas") === "1";
        const filas = await listMaestro(c.schema, c.empresaId, tabla, { todas });
        return NextResponse.json(successResponse({ filas }));
      } catch (err) {
        console.error(`[/api/${tabla} GET]`, err instanceof Error ? err.message : err);
        return NextResponse.json(errorResponse(`No se pudieron leer las ${etiqueta}.`), { status: 500 });
      }
    },

    async POST(request: NextRequest) {
      try {
        const c = await ctxOf(request);
        if (!c) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
        const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const nombre = txt(b.nombre, 120);
        if (!nombre) return NextResponse.json(errorResponse("El nombre es obligatorio."), { status: 400 });
        try {
          const fila = await insertMaestro(c.schema, c.empresaId, tabla, {
            nombre,
            codigo: txt(b.codigo, 30),
            descripcion: txt(b.descripcion, 500),
            activo: b.activo !== false,
            proveedor_id: uuidOrNull(b.proveedor_id),
          });
          return NextResponse.json(successResponse({ fila }));
        } catch (e) {
          const msg = e instanceof Error ? e.message : "";
          if (/duplicate key|unique|23505/i.test(msg)) {
            return NextResponse.json(errorResponse(`Ya existe un registro con ese nombre.`), { status: 409 });
          }
          throw e;
        }
      } catch (err) {
        console.error(`[/api/${tabla} POST]`, err instanceof Error ? err.message : err);
        return NextResponse.json(errorResponse(`No se pudo crear.`), { status: 500 });
      }
    },

    async PATCH(request: NextRequest) {
      try {
        const c = await ctxOf(request);
        if (!c) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
        const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const id = uuidOrNull(b.id);
        if (!id) return NextResponse.json(errorResponse("Falta el id."), { status: 400 });

        const patch: Record<string, unknown> = {};
        if (b.nombre !== undefined) {
          const n = txt(b.nombre, 120);
          if (!n) return NextResponse.json(errorResponse("El nombre no puede quedar vacío."), { status: 400 });
          patch.nombre = n;
        }
        if (b.codigo !== undefined) patch.codigo = txt(b.codigo, 30);
        if (b.descripcion !== undefined) patch.descripcion = txt(b.descripcion, 500);
        if (b.activo !== undefined) patch.activo = b.activo === true;
        if (b.proveedor_id !== undefined) patch.proveedor_id = uuidOrNull(b.proveedor_id);

        try {
          const fila = await updateMaestro(c.schema, c.empresaId, tabla, id, patch);
          if (!fila) return NextResponse.json(errorResponse("Registro no encontrado."), { status: 404 });
          return NextResponse.json(successResponse({ fila }));
        } catch (e) {
          const msg = e instanceof Error ? e.message : "";
          if (/duplicate key|unique|23505/i.test(msg)) {
            return NextResponse.json(errorResponse("Ya existe un registro con ese nombre."), { status: 409 });
          }
          throw e;
        }
      } catch (err) {
        console.error(`[/api/${tabla} PATCH]`, err instanceof Error ? err.message : err);
        return NextResponse.json(errorResponse("No se pudo actualizar."), { status: 500 });
      }
    },

    async DELETE(request: NextRequest) {
      try {
        const c = await ctxOf(request);
        if (!c) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
        const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const id = uuidOrNull(b.id);
        if (!id) return NextResponse.json(errorResponse("Falta el id."), { status: 400 });
        const r = await deleteMaestro(c.schema, c.empresaId, tabla, id);
        if (!r.deleted) return NextResponse.json(errorResponse("Registro no encontrado."), { status: 404 });
        return NextResponse.json(successResponse({ id, productosAfectados: r.productosAfectados }));
      } catch (err) {
        console.error(`[/api/${tabla} DELETE]`, err instanceof Error ? err.message : err);
        return NextResponse.json(errorResponse("No se pudo borrar."), { status: 500 });
      }
    },
  };
}
