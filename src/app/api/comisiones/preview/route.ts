import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { computePreviewPeriod } from "@/lib/comisiones/comision-period";
import {
  buildMontoNcAprobadaPorFacturaIdPreview,
  esFacturaAnuladaPreview,
  esFacturaCorregidaNcPreview,
  montoFacturaNetoValorComercialPreview,
  type FacturaPreviewRow,
  type NotaCreditoPreviewRow,
} from "@/lib/comisiones/factura-neto-preview";
import {
  cargarNombresUsuarios,
  comisionPorTramo,
  repartoProporcional,
  resolverTramo,
  type EscalaPolitica,
  type TierResult,
} from "@/lib/comisiones/comision-preview-calculator";
import { requireComisionesModuleAccess } from "@/lib/comisiones/comisiones-auth";
import { esRolAdminEmpresaOGlobal } from "@/lib/auth/rol-empresa";
import { errorResponse, successResponse } from "@/lib/api/response";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { isErpRolSupervisor, isErpRolVendedor } from "@/lib/usuarios/erp-rol-normalize";

type LineaPreview = {
  tipo: "pago" | "factura_emitida" | "factura_pagada";
  cliente_id: string | null;
  cliente_label: string;
  factura_id: string | null;
  numero_factura?: string | null;
  pago_id: string | null;
  fecha: string | null;
  monto_base: number;
  comision_estimada_linea: number;
  cobrado_periodo: number;
  saldo_pendiente: number;
  pendiente_por_comisionar: number;
};

const PAGE = 800;

/**
 * Tope de seguridad para los `for (let from = 0; ; from += PAGE)` que recorren
 * tablas paginando 800 filas. Si una tabla supera 200 * 800 = 160k filas, asumimos
 * algo se rompio (cliente con un periodo gigante, query mal armada, loop infinito
 * por bug en backend de paginacion). Mejor fallar rapido con mensaje claro que
 * colgar el request indefinidamente y bloquear el pool.
 */
const MAX_PAGES = 200;

const ALERTA_NC_OMITIDA =
  "No se pudieron considerar notas de crédito en esta preview para este schema. El neto de factura se calcula sin descontar NC.";

function esErrorTablaNoDisponible(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("could not find the table") ||
    m.includes("schema cache") ||
    m.includes("does not exist") ||
    /relation\s+["']?[\w.]+\s+does not exist/.test(m)
  );
}

async function cargarNcAprobadasPorFacturaId(
  sb: Awaited<ReturnType<typeof getChatServiceClientForEmpresa>>,
  empresaId: string
): Promise<{ ncMap: Map<string, number>; alertaNetoSinNc?: string }> {
  const ncRowsRaw: Record<string, unknown>[] = [];
  try {
    let pageCount = 0;
    for (let from = 0; ; from += PAGE) {
      if (++pageCount > MAX_PAGES) {
        // Guard de seguridad: no consumir el pool por un loop infinito o tabla
        // exageradamente grande. 200 paginas * 800 filas = 160k filas tope.
        throw new Error(`MAX_PAGES (${MAX_PAGES}) excedido en nota_credito (empresa ${empresaId.slice(0, 8)})`);
      }
      const { data, error } = await sb
        .from("nota_credito")
        .select("factura_id, monto, estado_erp")
        .eq("empresa_id", empresaId)
        .range(from, from + PAGE - 1);
      if (error) {
        if (esErrorTablaNoDisponible(error.message)) {
          console.warn("[api/comisiones/preview] nota_credito no disponible", {
            empresa_id_prefix: empresaId.length >= 8 ? empresaId.slice(0, 8) : empresaId,
            detail: error.message.slice(0, 200),
          });
          return { ncMap: new Map(), alertaNetoSinNc: ALERTA_NC_OMITIDA };
        }
        throw new Error(error.message);
      }
      const chunk = data ?? [];
      ncRowsRaw.push(...chunk);
      if (chunk.length < PAGE) break;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (esErrorTablaNoDisponible(msg)) {
      console.warn("[api/comisiones/preview] nota_credito omitida", {
        empresa_id_prefix: empresaId.length >= 8 ? empresaId.slice(0, 8) : empresaId,
        detail: msg.slice(0, 200),
      });
      return { ncMap: new Map(), alertaNetoSinNc: ALERTA_NC_OMITIDA };
    }
    throw e;
  }

  const ncMap = buildMontoNcAprobadaPorFacturaIdPreview(
    ncRowsRaw.map((r) => ({
      factura_id: String(r.factura_id ?? ""),
      monto: Number(r.monto) || 0,
      estado_erp: String(r.estado_erp ?? ""),
    })) as NotaCreditoPreviewRow[]
  );
  return { ncMap };
}

function parseEscalas(rows: Record<string, unknown>[] | null): EscalaPolitica[] {
  if (!rows?.length) return [];
  return rows.map((r, i) => ({
    orden: typeof r.orden === "number" ? r.orden : i,
    desde_monto: Number(r.desde_monto) || 0,
    hasta_monto: r.hasta_monto == null ? null : Number(r.hasta_monto),
    porcentaje_comision: Number(r.porcentaje_comision) || 0,
    premio_fijo: r.premio_fijo == null ? null : Number(r.premio_fijo),
  }));
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseMesConsulta(request: Request): { year: number; month: number } | null {
  const url = new URL(request.url);
  const raw = (url.searchParams.get("mes") ?? url.searchParams.get("month") ?? "").trim();
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(raw);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

function saldoPendienteFactura(fac: FacturaPreviewRow, neto: number, pagadoFallback?: number): number {
  const saldo = Number(fac.saldo);
  if (Number.isFinite(saldo)) return roundMoney(Math.max(0, saldo));
  if (pagadoFallback == null) return 0;
  return roundMoney(Math.max(0, neto - pagadoFallback));
}

type EscalaProgreso = {
  escala_actual_desde: number | null;
  escala_actual_hasta: number | null;
  escala_actual_porcentaje: number | null;
  escala_actual_premio_fijo: number | null;
  siguiente_escala_desde: number | null;
  siguiente_escala_porcentaje: number | null;
  falta_para_siguiente_escala: number | null;
  progreso_hacia_siguiente_pct: number | null;
  max_escala_alcanzada: boolean;
};

function calcularProgresoEscala(revenue: number, escalas: EscalaPolitica[]): EscalaProgreso {
  const sorted = [...escalas].sort((a, b) => {
    const da = Number(a.desde_monto) || 0;
    const db = Number(b.desde_monto) || 0;
    if (da !== db) return da - db;
    return a.orden - b.orden;
  });

  if (sorted.length === 0) {
    return {
      escala_actual_desde: null,
      escala_actual_hasta: null,
      escala_actual_porcentaje: null,
      escala_actual_premio_fijo: null,
      siguiente_escala_desde: null,
      siguiente_escala_porcentaje: null,
      falta_para_siguiente_escala: null,
      progreso_hacia_siguiente_pct: null,
      max_escala_alcanzada: false,
    };
  }

  let actual: EscalaPolitica | null = null;
  let actualIndex = -1;
  for (let i = 0; i < sorted.length; i += 1) {
    const desde = Number(sorted[i]?.desde_monto) || 0;
    if (revenue >= desde) {
      actual = sorted[i] ?? null;
      actualIndex = i;
    }
  }

  const siguiente = sorted[actualIndex + 1] ?? (actual ? null : sorted[0] ?? null);
  const siguienteDesde = siguiente ? Number(siguiente.desde_monto) || 0 : null;
  const actualDesde = actual ? Number(actual.desde_monto) || 0 : null;
  const falta =
    siguienteDesde == null
      ? null
      : Math.max(0, roundMoney(siguienteDesde - revenue));

  let progreso: number | null = null;
  if (siguienteDesde != null) {
    if (actualDesde == null) {
      progreso = siguienteDesde > 0 ? (revenue / siguienteDesde) * 100 : 100;
    } else {
      const tramo = siguienteDesde - actualDesde;
      progreso = tramo > 0 ? ((revenue - actualDesde) / tramo) * 100 : 100;
    }
    progreso = Math.max(0, Math.min(100, Math.round(progreso)));
  }

  return {
    escala_actual_desde: actualDesde,
    escala_actual_hasta: actual?.hasta_monto == null ? null : Number(actual.hasta_monto) || 0,
    escala_actual_porcentaje: actual == null ? null : Number(actual.porcentaje_comision) || 0,
    escala_actual_premio_fijo:
      actual == null ? null : actual.premio_fijo == null ? 0 : Number(actual.premio_fijo) || 0,
    siguiente_escala_desde: siguienteDesde,
    siguiente_escala_porcentaje: siguiente == null ? null : Number(siguiente.porcentaje_comision) || 0,
    falta_para_siguiente_escala: falta,
    progreso_hacia_siguiente_pct: progreso,
    max_escala_alcanzada: actual != null && siguiente == null,
  };
}

/** GET — preview read-only de comisiones del período actual (sin persistir liquidaciones). */
export async function GET(request: Request) {
  const auth = await requireComisionesModuleAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  const catalog = createServiceRoleClient();
  const sb = await getChatServiceClientForEmpresa(auth.empresaId);
  const empresaId = auth.empresaId;

  try {
    const { data: politicaRaw } = await sb
      .from("comision_politicas")
      .select("*")
      .eq("empresa_id", empresaId)
      .maybeSingle();

    if (!politicaRaw || typeof politicaRaw !== "object") {
      return NextResponse.json(
        successResponse({
          estado: "sin_politica",
          mensaje: "No hay política de comisiones configurada para esta empresa.",
          meta: null,
          kpis: null,
          por_vendedor: [],
          documentacion: {
            factura_pagada_criterio_fecha:
              "Factura incluida si la fecha del último pago (MAX(pagos.fecha_pago)) cae en el período y la factura está liquidada.",
          },
        })
      );
    }

    const politica = politicaRaw as Record<string, unknown>;
    const activo = politica.activo !== false;
    if (!activo) {
      return NextResponse.json(
        successResponse({
          estado: "politica_inactiva",
          mensaje:
            "La política existe pero está inactiva. Activala en Configuración → Comisiones para ver la vista previa.",
          meta: null,
          kpis: null,
          por_vendedor: [],
          documentacion: {},
        })
      );
    }

    const pid = String(politica.id ?? "");
    const tz =
      typeof politica.timezone === "string" && politica.timezone.trim()
        ? politica.timezone.trim()
        : "America/Asuncion";
    const modoPeriodo =
      typeof politica.modo_periodo === "string" && politica.modo_periodo.trim()
        ? politica.modo_periodo.trim()
        : "mensual_penultimo_dia_habil";
    const baseCalculo =
      typeof politica.base_calculo === "string" ? politica.base_calculo.trim() : "pago_registrado";

    const { data: escalasRows } = await sb
      .from("comision_escalas")
      .select("*")
      .eq("empresa_id", empresaId)
      .eq("politica_id", pid)
      .order("orden", { ascending: true })
      .order("desde_monto", { ascending: true });

    const escalas = parseEscalas((escalasRows ?? []) as Record<string, unknown>[]);
    const sinEscalas = escalas.length === 0;

    const mesConsulta = parseMesConsulta(request);
    const periodAnchor = mesConsulta
      ? new Date(Date.UTC(mesConsulta.year, mesConsulta.month - 1, 15, 12, 0, 0))
      : new Date();
    const period = computePreviewPeriod(periodAnchor, tz, modoPeriodo);
    const desdeYmd = period.fechaInicioLocal;
    const hastaYmd = period.fechaFinLocal;

    const clientesRows: Record<string, unknown>[] = [];
    {
      let pageCount = 0;
      for (let from = 0; ; from += PAGE) {
        if (++pageCount > MAX_PAGES) {
          throw new Error(`MAX_PAGES (${MAX_PAGES}) excedido en clientes (empresa ${empresaId.slice(0, 8)})`);
        }
        const { data, error } = await sb
          .from("clientes")
          .select("id, empresa, nombre_contacto, vendedor_usuario_id")
          .eq("empresa_id", empresaId)
          .range(from, from + PAGE - 1);
        if (error) throw new Error(error.message);
        const chunk = data ?? [];
        clientesRows.push(...chunk);
        if (chunk.length < PAGE) break;
      }
    }

    const clienteNombre = new Map<string, string>();
    const clienteVendedor = new Map<string, string | null>();
    for (const c of clientesRows) {
      const id = String(c.id ?? "");
      const nom = String(c.nombre_contacto ?? c.empresa ?? "").trim() || id.slice(0, 8);
      clienteNombre.set(id, nom);
      const v = c.vendedor_usuario_id;
      clienteVendedor.set(id, typeof v === "string" && v.trim() ? v.trim() : null);
    }

    const { ncMap, alertaNetoSinNc } = await cargarNcAprobadasPorFacturaId(sb, empresaId);

    const clientesAsignadosAutenticado = clientesRows.filter((c) => {
      const v = c.vendedor_usuario_id;
      return typeof v === "string" && v.trim() === auth.usuarioCatalogId;
    }).length;
    const verTodoEmpresa = esRolAdminEmpresaOGlobal(auth.rol) || isErpRolSupervisor(auth.rol);
    const rolVendedor = isErpRolVendedor(auth.rol);
    const soloVendedor = !verTodoEmpresa;
    const vendedorScopeId = soloVendedor ? auth.usuarioCatalogId : null;
    const vendedorDetectadoPor = !soloVendedor
      ? "rol_admin"
      : rolVendedor
        ? "rol"
        : clientesAsignadosAutenticado > 0
          ? "clientes_asignados"
          : "otro";

    const lineas: LineaPreview[] = [];
    let alertasSinVendedorPagos = 0;
    let alertasSinVendedorFacturas = 0;

    const pushLine = (L: LineaPreview, tieneVendedor: boolean, tipoAlerta: "pago" | "factura") => {
      if (!tieneVendedor) {
        if (tipoAlerta === "pago") alertasSinVendedorPagos += 1;
        else alertasSinVendedorFacturas += 1;
      }
      lineas.push(L);
    };

    const netFact = (f: FacturaPreviewRow) => montoFacturaNetoValorComercialPreview(f, ncMap);

    if (baseCalculo === "pago_registrado") {
      const pagos: Record<string, unknown>[] = [];
      {
        let pageCount = 0;
        for (let from = 0; ; from += PAGE) {
          if (++pageCount > MAX_PAGES) {
            throw new Error(`MAX_PAGES (${MAX_PAGES}) excedido en pagos (empresa ${empresaId.slice(0, 8)}, periodo ${desdeYmd}..${hastaYmd})`);
          }
          const { data, error } = await sb
            .from("pagos")
            .select("id, factura_id, monto, fecha_pago")
            .eq("empresa_id", empresaId)
            .gte("fecha_pago", desdeYmd)
            .lte("fecha_pago", hastaYmd)
            .range(from, from + PAGE - 1);
          if (error) throw new Error(error.message);
          const chunk = data ?? [];
          pagos.push(...chunk);
          if (chunk.length < PAGE) break;
        }
      }

      const facturaIds = [...new Set(pagos.map((p) => String(p.factura_id ?? "")).filter(Boolean))];
      const facturasPorId = new Map<string, FacturaPreviewRow>();
      for (let i = 0; i < facturaIds.length; i += 120) {
        const slice = facturaIds.slice(i, i + 120);
        const { data: facts, error } = await sb.from("facturas").select("*").eq("empresa_id", empresaId).in("id", slice);
        if (error) throw new Error(error.message);
        for (const f of facts ?? []) {
          const fr = f as unknown as FacturaPreviewRow;
          facturasPorId.set(String(fr.id), fr);
        }
      }

      for (const p of pagos) {
        const fid = String(p.factura_id ?? "");
        const fac = facturasPorId.get(fid);
        if (!fac || esFacturaAnuladaPreview(fac.estado) || esFacturaCorregidaNcPreview(fac.estado)) continue;
        const clienteId = String(fac.cliente_id ?? "");
        const vid = clienteVendedor.get(clienteId) ?? null;
        const monto = Number(p.monto) || 0;
        const net = netFact(fac);
        const saldoPendiente = saldoPendienteFactura(fac, net);
        const fecha = p.fecha_pago != null ? String(p.fecha_pago) : null;
        pushLine(
          {
            tipo: "pago",
            cliente_id: clienteId || null,
            cliente_label: clienteNombre.get(clienteId) ?? clienteId,
            factura_id: fid,
            numero_factura: fac.numero_factura ?? null,
            pago_id: String(p.id ?? ""),
            fecha,
            monto_base: monto,
            comision_estimada_linea: 0,
            cobrado_periodo: roundMoney(monto),
            saldo_pendiente: saldoPendiente,
            pendiente_por_comisionar: saldoPendiente,
          },
          Boolean(vid),
          "pago"
        );
      }
    } else if (baseCalculo === "factura_emitida") {
      const facturas: Record<string, unknown>[] = [];
      let pageCountF = 0;
      for (let from = 0; ; from += PAGE) {
        if (++pageCountF > MAX_PAGES) {
          throw new Error(`MAX_PAGES (${MAX_PAGES}) excedido en facturas (empresa ${empresaId.slice(0, 8)}, periodo ${desdeYmd}..${hastaYmd})`);
        }
        const { data, error } = await sb
          .from("facturas")
          .select("*")
          .eq("empresa_id", empresaId)
          .gte("fecha", desdeYmd)
          .lte("fecha", hastaYmd)
          .range(from, from + PAGE - 1);
        if (error) throw new Error(error.message);
        const chunk = data ?? [];
        facturas.push(...chunk);
        if (chunk.length < PAGE) break;
      }

      const pagosPeriodoPorFactura = new Map<string, number>();
      const facturaIds = [...new Set(facturas.map((f) => String(f.id ?? "")).filter(Boolean))];
      for (let i = 0; i < facturaIds.length; i += 120) {
        const slice = facturaIds.slice(i, i + 120);
        const { data: pagosPeriodo, error } = await sb
          .from("pagos")
          .select("factura_id, monto, fecha_pago")
          .eq("empresa_id", empresaId)
          .in("factura_id", slice)
          .gte("fecha_pago", desdeYmd)
          .lte("fecha_pago", hastaYmd);
        if (error) throw new Error(error.message);
        for (const p of pagosPeriodo ?? []) {
          const fid = String((p as Record<string, unknown>).factura_id ?? "");
          if (!fid) continue;
          pagosPeriodoPorFactura.set(fid, (pagosPeriodoPorFactura.get(fid) ?? 0) + (Number((p as Record<string, unknown>).monto) || 0));
        }
      }

      for (const row of facturas) {
        const fac = row as unknown as FacturaPreviewRow;
        if (esFacturaAnuladaPreview(fac.estado) || esFacturaCorregidaNcPreview(fac.estado)) continue;
        const clienteId = String(fac.cliente_id ?? "");
        const vid = clienteVendedor.get(clienteId) ?? null;
        const net = netFact(fac);
        if (net <= 0) continue;
        const fid = String(fac.id);
        const cobradoPeriodo = roundMoney(pagosPeriodoPorFactura.get(fid) ?? 0);
        const saldoPendiente = saldoPendienteFactura(fac, net);
        pushLine(
          {
            tipo: "factura_emitida",
            cliente_id: clienteId || null,
            cliente_label: clienteNombre.get(clienteId) ?? clienteId,
            factura_id: fid,
            numero_factura: fac.numero_factura ?? null,
            pago_id: null,
            fecha: fac.fecha ?? null,
            monto_base: net,
            comision_estimada_linea: 0,
            cobrado_periodo: cobradoPeriodo,
            saldo_pendiente: saldoPendiente,
            pendiente_por_comisionar: 0,
          },
          Boolean(vid),
          "factura"
        );
      }
    } else if (baseCalculo === "factura_pagada") {
      const pagosHist: Record<string, unknown>[] = [];
      let pageCountPH = 0;
      for (let from = 0; ; from += PAGE) {
        if (++pageCountPH > MAX_PAGES) {
          throw new Error(`MAX_PAGES (${MAX_PAGES}) excedido en pagosHist (empresa ${empresaId.slice(0, 8)})`);
        }
        const { data, error } = await sb
          .from("pagos")
          .select("factura_id, fecha_pago, monto")
          .eq("empresa_id", empresaId)
          .lte("fecha_pago", hastaYmd)
          .range(from, from + PAGE - 1);
        if (error) throw new Error(error.message);
        const chunk = data ?? [];
        pagosHist.push(...chunk);
        if (chunk.length < PAGE) break;
      }

      const maxFechaPorFactura = new Map<string, string>();
      const sumPagosPorFactura = new Map<string, number>();
      const sumPagosPeriodoPorFactura = new Map<string, number>();
      for (const p of pagosHist) {
        const fid = String(p.factura_id ?? "");
        if (!fid) continue;
        const fp = p.fecha_pago != null ? String(p.fecha_pago).slice(0, 10) : "";
        const prev = maxFechaPorFactura.get(fid);
        if (!prev || fp > prev) maxFechaPorFactura.set(fid, fp);
        const montoPago = Number(p.monto) || 0;
        sumPagosPorFactura.set(fid, (sumPagosPorFactura.get(fid) ?? 0) + montoPago);
        if (fp >= desdeYmd && fp <= hastaYmd) {
          sumPagosPeriodoPorFactura.set(fid, (sumPagosPeriodoPorFactura.get(fid) ?? 0) + montoPago);
        }
      }

      const candidatos = [...maxFechaPorFactura.entries()].filter(
        ([, d]) => d >= desdeYmd && d <= hastaYmd
      );

      const facturaIds = candidatos.map(([id]) => id);
      for (let i = 0; i < facturaIds.length; i += 80) {
        const slice = facturaIds.slice(i, i + 80);
        const { data: facts, error } = await sb.from("facturas").select("*").eq("empresa_id", empresaId).in("id", slice);
        if (error) throw new Error(error.message);
        for (const row of facts ?? []) {
          const fac = row as unknown as FacturaPreviewRow;
          if (esFacturaAnuladaPreview(fac.estado) || esFacturaCorregidaNcPreview(fac.estado)) continue;
          const fid = String(fac.id);
          const net = netFact(fac);
          const sumPag = sumPagosPorFactura.get(fid) ?? 0;
          const saldo = Number(fac.saldo);
          const liquidada =
            (Number.isFinite(saldo) && saldo <= 0.02) || (net > 0 && sumPag >= net - 0.05);
          if (!liquidada || net <= 0) continue;

          const clienteId = String(fac.cliente_id ?? "");
          const vid = clienteVendedor.get(clienteId) ?? null;
          const ultima = maxFechaPorFactura.get(fid) ?? null;
          const saldoPendiente = saldoPendienteFactura(fac, net, sumPag);

          pushLine(
            {
              tipo: "factura_pagada",
              cliente_id: clienteId || null,
              cliente_label: clienteNombre.get(clienteId) ?? clienteId,
              factura_id: fid,
              numero_factura: fac.numero_factura ?? null,
              pago_id: null,
              fecha: ultima,
              monto_base: net,
              comision_estimada_linea: 0,
              cobrado_periodo: roundMoney(sumPagosPeriodoPorFactura.get(fid) ?? 0),
              saldo_pendiente: saldoPendiente,
              pendiente_por_comisionar: 0,
            },
            Boolean(vid),
            "factura"
          );
        }
      }
    }

    const filtradas =
      vendedorScopeId != null
        ? lineas.filter((l) => {
            const cid = l.cliente_id;
            if (!cid) return false;
            return clienteVendedor.get(cid) === vendedorScopeId;
          })
        : lineas;

    type Agg = {
      vendorId: string;
      revenue: number;
      cobradoPeriodo: number;
      saldoPendiente: number;
      pendientePorComisionar: number;
      facturasConPendiente: Set<string>;
      lines: LineaPreview[];
    };
    const porVendor = new Map<string, Agg>();

    for (const ln of filtradas) {
      const cid = ln.cliente_id;
      if (!cid) continue;
      const vid = clienteVendedor.get(cid);
      if (!vid) continue;
      let agg = porVendor.get(vid);
      if (!agg) {
        agg = {
          vendorId: vid,
          revenue: 0,
          cobradoPeriodo: 0,
          saldoPendiente: 0,
          pendientePorComisionar: 0,
          facturasConPendiente: new Set(),
          lines: [],
        };
        porVendor.set(vid, agg);
      }
      agg.revenue += ln.monto_base;
      agg.cobradoPeriodo += ln.cobrado_periodo;
      const facturaKey = ln.factura_id ?? `linea-${agg.lines.length}`;
      if (!agg.facturasConPendiente.has(facturaKey)) {
        agg.facturasConPendiente.add(facturaKey);
        agg.saldoPendiente += ln.saldo_pendiente;
        agg.pendientePorComisionar += ln.pendiente_por_comisionar;
      }
      agg.lines.push({ ...ln });
    }

    const idsVendedores = [...porVendor.keys()];
    const nombres = await cargarNombresUsuarios(catalog, idsVendedores);

    const porVendedorOut: Record<string, unknown>[] = [];
    let revenueTotal = 0;
    let comisionTotal = 0;
    let cobradoTotal = 0;
    let pendienteCobroTotal = 0;
    let pendienteComisionarTotal = 0;

    for (const [, agg] of porVendor) {
      revenueTotal += agg.revenue;
      cobradoTotal += agg.cobradoPeriodo;
      pendienteCobroTotal += agg.saldoPendiente;
      pendienteComisionarTotal += agg.pendientePorComisionar;
      const tier: TierResult | null = sinEscalas ? null : resolverTramo(agg.revenue, escalas);
      const comisionVen = sinEscalas ? 0 : comisionPorTramo(agg.revenue, tier);
      const progresoEscala = calcularProgresoEscala(agg.revenue, escalas);
      comisionTotal += comisionVen;

      const montos = agg.lines.map((l) => l.monto_base);
      const shares = repartoProporcional(comisionVen, montos);
      const linesOut = agg.lines.map((l, i) => ({
        ...l,
        comision_estimada_linea: shares[i] ?? 0,
      }));

      porVendedorOut.push({
        vendedor_usuario_id: agg.vendorId,
        vendedor_nombre: nombres.get(agg.vendorId) ?? agg.vendorId.slice(0, 8),
        cantidad_movimientos: agg.lines.length,
        revenue_base: Math.round(agg.revenue * 100) / 100,
        cobrado_periodo_total: roundMoney(agg.cobradoPeriodo),
        saldo_pendiente_total: roundMoney(agg.saldoPendiente),
        pendiente_por_comisionar_total: roundMoney(agg.pendientePorComisionar),
        escala_aplicada: tier?.etiqueta ?? (sinEscalas ? "Sin escalas configuradas" : "—"),
        porcentaje_tramo: tier?.porcentaje ?? 0,
        premio_fijo_tramo: tier?.premioFijo ?? 0,
        ...progresoEscala,
        comision_estimada: Math.round(comisionVen * 100) / 100,
        lineas: linesOut,
      });
    }

    porVendedorOut.sort((a, b) => Number(b.revenue_base) - Number(a.revenue_base));

    const fuentesSinVendedorKpi = soloVendedor
      ? 0
      : alertasSinVendedorPagos + alertasSinVendedorFacturas;

    const kpis = {
      revenue_base_total: Math.round(revenueTotal * 100) / 100,
      comision_estimada_total: Math.round(comisionTotal * 100) / 100,
      cobrado_periodo_total: roundMoney(cobradoTotal),
      saldo_pendiente_total: roundMoney(pendienteCobroTotal),
      pendiente_por_comisionar_total: roundMoney(pendienteComisionarTotal),
      vendedores_con_comision: porVendedorOut.length,
      fuentes_sin_vendedor: fuentesSinVendedorKpi,
      alertas_sin_vendedor_pagos: soloVendedor ? 0 : alertasSinVendedorPagos,
      alertas_sin_vendedor_facturas: soloVendedor ? 0 : alertasSinVendedorFacturas,
    };

    return NextResponse.json(
      successResponse({
        estado: "ok",
        mensaje:
          "Vista previa: no genera liquidación, no escribe comision_lineas ni cierra períodos.",
        meta: {
          preview: true,
          periodo: period.etiquetaMes,
          timezone: period.timezone,
          modo_periodo: period.modoPeriodo,
          fecha_inicio_local: desdeYmd,
          fecha_fin_local: hastaYmd,
          periodo_inicio_utc: period.periodoInicioUtcIso,
          periodo_fin_utc: period.periodoFinUtcIso,
          periodo_mes: period.fechaInicioLocal.slice(0, 7),
          politica_id: pid,
          politica_nombre: String(politica.nombre ?? ""),
          base_calculo: baseCalculo,
          sin_escalas: sinEscalas,
          alcance: soloVendedor ? "solo_vendedor_autenticado" : "empresa",
          viewer_role: auth.rol ?? null,
          viewer_scope: soloVendedor ? "vendedor" : "admin",
          viewer_usuario_id: auth.usuarioCatalogId,
          is_vendedor_view: soloVendedor,
          vendedor_detectado_por: vendedorDetectadoPor,
          vendedor_clientes_asignados: clientesAsignadosAutenticado,
          supervisor_equipos_pendiente: isErpRolSupervisor(auth.rol),
          alerta_neto_sin_nc: alertaNetoSinNc ?? null,
          documentacion_base: {
            pago_registrado:
              "Suma pagos.monto con fecha_pago en el período; factura no anulada ni corregida NC; cliente con vendedor_usuario_id.",
            factura_emitida:
              "Monto neto comercial (monto − NC aprobadas) con fecha de factura en el período.",
            factura_pagada:
              "Facturas liquidadas cuya fecha del último pago (máximo fecha_pago por factura, hasta el fin del período) cae en el período; monto neto comercial.",
          },
        },
        kpis,
        por_vendedor: porVendedorOut,
      })
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
