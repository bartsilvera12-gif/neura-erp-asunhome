/**
 * Pruebas técnicas: canal WhatsApp + validación comprobantes (hash, OCR, duplicados, finalize).
 *
 * Requiere .env.local: DB (SUPABASE_DB_URL o password+URL), SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL.
 * Opcional: GOOGLE_CLOUD_VISION_API_KEY (prueba 2 usa Vision si no hay override).
 *
 * npx tsx scripts/technical-tests-comprobante-full.ts
 */
import { config } from "dotenv";
import { createHash } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { join } from "path";
import pg from "pg";

config({ path: join(process.cwd(), ".env.local") });

const { Client } = pg;

function getDbUrl(): string {
  const direct = process.env.SUPABASE_DB_URL?.trim();
  if (direct) return direct;
  const password = process.env.SUPABASE_DB_PASSWORD?.trim();
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const m = base?.match(/https:\/\/([^.]+)\.supabase\.co/i);
  if (!password || !m?.[1]) {
    throw new Error(
      "Falta SUPABASE_DB_URL o (SUPABASE_DB_PASSWORD + NEXT_PUBLIC_SUPABASE_URL) en .env.local"
    );
  }
  const ref = m[1];
  return `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`;
}

function hashOf(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function cerrariaCompra(estado: string): "SÍ" | "NO" {
  return estado === "valido" ? "SÍ" : "NO";
}

type Informe = {
  prueba: string;
  exitosa: boolean;
  ids?: Record<string, string>;
  estado_validacion?: string;
  motivo_validacion?: string;
  hash_sha256?: string;
  ocr_ejecutado?: string;
  cerraria_al_confirmar?: "SÍ" | "NO";
  orden_rpc?: string;
  detalle?: string;
};

async function upsertFlowDataFromPipeline(
  supabase: SupabaseClient,
  rows: Array<{
    empresa_id: string;
    conversation_id: string;
    flow_code: string;
    flow_session_id: string;
    field_name: string;
    field_value: string;
  }>
) {
  if (rows.length === 0) return;
  const { error } = await supabase.from("chat_flow_data").upsert(rows, {
    onConflict: "flow_session_id,field_name",
  });
  if (error) throw new Error(`chat_flow_data upsert: ${error.message}`);
}

async function loadFlowDataMap(
  supabase: SupabaseClient,
  flowSessionId: string
): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from("chat_flow_data")
    .select("field_name, field_value")
    .eq("flow_session_id", flowSessionId);
  if (error) throw new Error(error.message);
  const m: Record<string, string> = {};
  for (const r of data ?? []) {
    m[String((r as { field_name: string }).field_name)] = String(
      (r as { field_value: string }).field_value ?? ""
    );
  }
  return m;
}

async function main() {
  const informes: Informe[] = [];
  const db = new Client({
    connectionString: getDbUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();

  const chQ = await db.query(
    `SELECT id, empresa_id, meta_phone_number_id, activo, provider, config, updated_at
     FROM public.chat_channels
     ORDER BY COALESCE(updated_at, created_at) DESC NULLS LAST
     LIMIT 1`
  );
  if (chQ.rows.length === 0) {
    console.log("FALLIDA: no hay chat_channels.");
    await db.end();
    process.exit(1);
  }
  const ch = chQ.rows[0] as Record<string, unknown>;
  const channelId = String(ch.id);
  const empresaId = String(ch.empresa_id);

  await db.query(
    `UPDATE public.chat_channels
     SET config = jsonb_set(
           COALESCE(config, '{}'::jsonb),
           '{comprobante_validation,enabled}',
           'true'::jsonb,
           true
         ),
         updated_at = now()
     WHERE id = $1::uuid`,
    [channelId]
  );

  const ch2 = await db.query(
    `SELECT id, empresa_id, meta_phone_number_id, activo, provider, config
     FROM public.chat_channels WHERE id = $1::uuid`,
    [channelId]
  );
  const row = ch2.rows[0] as Record<string, unknown>;
  const cfg = row.config as Record<string, unknown> | null;
  const cv = cfg?.comprobante_validation as Record<string, unknown> | undefined;

  const t1Ok =
    row.activo === true &&
    String(row.provider) === "meta" &&
    cv?.enabled === true &&
    cv?.messages != null &&
    cv?.ocr_fields != null;

  informes.push({
    prueba: "1) Canal actual (activo, enabled=true, config persistida)",
    exitosa: t1Ok,
    ids: { channel_id: channelId, empresa_id: empresaId },
    detalle: JSON.stringify(
      {
        activo: row.activo,
        provider: row.provider,
        meta_phone_number_id: row.meta_phone_number_id,
        comprobante_validation_enabled: cv?.enabled,
        tiene_messages: cv?.messages != null,
        tiene_ocr_fields: cv?.ocr_fields != null,
        bloquear_por_hash: cv?.bloquear_por_hash_duplicado,
        ocr_obligatorio: cv?.ocr_obligatorio,
      },
      null,
      0
    ),
  });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const sr = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !sr) {
    informes.push({
      prueba: "2–6) Pipeline",
      exitosa: false,
      detalle: "Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY",
    });
    printInformes(informes);
    await db.end();
    process.exit(1);
  }

  const supabase = createClient(url, sr, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const convQ = await db.query(
    `SELECT c.id AS conversation_id, c.channel_id, c.flow_code, c.active_flow_session_id, ct.phone_number
     FROM public.chat_conversations c
     JOIN public.chat_contacts ct ON ct.id = c.contact_id
     WHERE c.channel_id = $1::uuid
     ORDER BY c.updated_at DESC NULLS LAST
     LIMIT 1`,
    [channelId]
  );
  if (convQ.rows.length === 0) {
    informes.push({
      prueba: "2) Comprobante válido",
      exitosa: false,
      detalle: "No hay conversación para este canal (enviá un mensaje al número primero).",
    });
    printInformes(informes);
    await db.end();
    process.exit(1);
  }

  const conv = convQ.rows[0] as Record<string, unknown>;
  let flowSessionId = conv.active_flow_session_id as string | null;
  let flowCode = String(conv.flow_code ?? "").trim() || "default";
  const conversationId = String(conv.conversation_id);
  const phoneDigits = String(conv.phone_number ?? "").replace(/\D/g, "");

  if (!flowSessionId) {
    const sQ = await db.query(
      `SELECT id, flow_code FROM public.chat_flow_sessions
       WHERE conversation_id = $1::uuid
       ORDER BY started_at DESC NULLS LAST LIMIT 1`,
      [conversationId]
    );
    if (sQ.rows.length === 0) {
      informes.push({
        prueba: "2) Comprobante válido",
        exitosa: false,
        detalle: "Sin flow_session para la conversación.",
      });
      printInformes(informes);
      await db.end();
      process.exit(1);
    }
    flowSessionId = String(sQ.rows[0].id);
    const fc = sQ.rows[0].flow_code as string | null;
    if (fc?.trim()) flowCode = fc.trim();
  }

  await db.query(
    `DELETE FROM public.chat_comprobante_validaciones
     WHERE empresa_id = $1::uuid
       AND (comprobante_media_id LIKE 'tech_test_%' OR motivo_validacion = 'seed_ocr_dup_test')`,
    [empresaId]
  );

  const { parseComprobanteValidationConfig } = await import(
    "../src/lib/chat/comprobante-validation-types"
  );
  const { runComprobanteValidationPipeline } = await import(
    "../src/lib/chat/comprobante-validation-service"
  );
  const { finalizeSorteoOrderFromConfirmedFlowData } = await import(
    "../src/lib/sorteos/sorteo-order-from-chat"
  );

  const settings = parseComprobanteValidationConfig(cfg);
  const visionKey = Boolean(process.env.GOOGLE_CLOUD_VISION_API_KEY?.trim());

  const pngA = await sharp({
    create: { width: 20, height: 20, channels: 3, background: { r: 11, g: 22, b: 33 } },
  })
    .png()
    .toBuffer();
  const pngB = await sharp({
    create: { width: 21, height: 21, channels: 3, background: { r: 201, g: 101, b: 51 } },
  })
    .png()
    .toBuffer();
  const pngC = await sharp({
    create: { width: 22, height: 22, channels: 3, background: { r: 55, g: 66, b: 77 } },
  })
    .png()
    .toBuffer();

  const hA = hashOf(pngA);
  const hB = hashOf(pngB);

  // --- Prueba 2: válido ---
  const longOcrValid =
    "Banco Itaú\nReferencia: TECHVAL999888\nMonto Gs. 2.000.000\nFecha 20/03/2026\nHora 14:00\nTransferencia acreditada correctamente.";

  const r2 = await runComprobanteValidationPipeline({
    supabase,
    empresaId,
    conversationId,
    channelId,
    flowCode,
    flowSessionId: String(flowSessionId),
    mediaId: "tech_test_t2_valido",
    publicUrl: "https://tech.test/t2.png",
    bytes: pngA,
    mimeType: "image/png",
    settings,
    ocrTextOverride: visionKey ? null : longOcrValid,
  });

  const r2Ok = r2.kind === "resolved" && r2.estado === "valido" && r2.advance === true;

  let ocrNote2 = visionKey
    ? "Google Cloud Vision (sin override; bytes reales pngA)"
    : "Texto OCR inyectado vía ocrTextOverride (entorno sin GOOGLE_CLOUD_VISION_API_KEY; mismo código de reglas que con OCR real)";
  if (visionKey && r2.kind === "resolved") {
    const { data: rowV } = await supabase
      .from("chat_comprobante_validaciones")
      .select("ocr_text_raw")
      .eq("id", r2.validationId)
      .single();
    const raw = (rowV as { ocr_text_raw?: string } | null)?.ocr_text_raw ?? "";
    ocrNote2 += ` → DB ocr len=${raw.length}`;
  }

  informes.push({
    prueba: "2) Comprobante nuevo → válido",
    exitosa: r2Ok,
    ids: { validation_id: r2.kind === "resolved" ? r2.validationId : "—" },
    estado_validacion: r2.kind === "resolved" ? r2.estado : "—",
    motivo_validacion: r2.kind === "resolved" ? r2.motivo : String(r2.kind),
    hash_sha256: hA,
    ocr_ejecutado: ocrNote2,
    cerraria_al_confirmar: r2.kind === "resolved" ? cerrariaCompra(r2.estado) : "NO",
    orden_rpc: "ver sub-prueba finalize abajo",
    detalle: `advance=${r2.kind === "resolved" ? r2.advance : "n/a"}`,
  });

  let finalizeNote =
    "omitido (TECH_TEST_RUN_FINALIZE=1 para upsert flow_data + RPC; sin eso no se toca chat_flow_data ni sorteos)";
  if (process.env.TECH_TEST_RUN_FINALIZE === "1" && r2.kind === "resolved" && r2.flowUpserts.length > 0) {
    await upsertFlowDataFromPipeline(supabase, r2.flowUpserts);
    const fd = await loadFlowDataMap(supabase, String(flowSessionId));
    const fin = await finalizeSorteoOrderFromConfirmedFlowData(supabase, {
      empresaId,
      conversationId,
      flowCode,
      flowSessionId: String(flowSessionId),
      whatsappNumero: phoneDigits || "0000000000000",
      flowData: fd,
    });
    if (fin.ok && !fin.skipped) {
      finalizeNote = `RPC OK entrada_id=${fin.entradaId} cupones=${fin.cupones.length}`;
    } else if (fin.ok && fin.skipped) {
      finalizeNote = `skipped reason=${fin.reason}`;
    } else {
      finalizeNote = `error ${"message" in fin ? fin.message : "?"}`;
    }
  }
  informes[informes.length - 1].orden_rpc = finalizeNote;

  // --- Prueba 3: mismo hash ---
  const r3 = await runComprobanteValidationPipeline({
    supabase,
    empresaId,
    conversationId,
    channelId,
    flowCode,
    flowSessionId: String(flowSessionId),
    mediaId: "tech_test_t3_dup_hash",
    publicUrl: "https://tech.test/t3.png",
    bytes: pngA,
    mimeType: "image/png",
    settings,
  });

  const msgOk =
    r3.kind === "resolved" &&
    r3.estado === "duplicado_hash" &&
    r3.advance === false &&
    r3.sendInteractive?.body === settings.messages.hash_duplicado;

  informes.push({
    prueba: "3) Misma imagen → duplicado_hash",
    exitosa: msgOk,
    ids: { validation_id: r3.kind === "resolved" ? r3.validationId : "—" },
    estado_validacion: r3.kind === "resolved" ? r3.estado : "—",
    motivo_validacion: r3.kind === "resolved" ? r3.motivo : String(r3.kind),
    hash_sha256: hA,
    cerraria_al_confirmar: r3.kind === "resolved" ? cerrariaCompra(r3.estado) : "NO",
    orden_rpc: "NO (finalize exige estado valido en flowData)",
    detalle: `mensaje_hash_config_coincide=${msgOk}; botones=${r3.kind === "resolved" && r3.sendInteractive ? r3.sendInteractive.buttons.map((b) => b.id).join(",") : "n/a"}`,
  });

  // --- Prueba 4: OCR duplicado (semilla + override) ---
  const altQ = await db.query(
    `SELECT s.id AS session_id, s.conversation_id, s.flow_code
     FROM public.chat_flow_sessions s
     JOIN public.chat_conversations c ON c.id = s.conversation_id
     WHERE c.empresa_id = $1::uuid AND s.id <> $2::uuid
     ORDER BY s.started_at DESC NULLS LAST
     LIMIT 1`,
    [empresaId, flowSessionId]
  );

  let r4Exitosa = false;
  let r4Estado = "—";
  let r4Motivo = "—";
  let r4Id = "—";
  let r4Detalle = "sin otra sesión en la empresa para semilla";

  if (altQ.rows.length > 0) {
    const alt = altQ.rows[0] as Record<string, unknown>;
    const seedSid = String(alt.session_id);
    const seedCid = String(alt.conversation_id);
    const seedFc = String(alt.flow_code ?? "seed").trim() || "seed";
    const seedHash = createHash("sha256").update(`seed_${Date.now()}`).digest("hex");

    await db.query(
      `INSERT INTO public.chat_comprobante_validaciones (
        empresa_id, conversation_id, flow_session_id, channel_id, flow_code,
        comprobante_url, comprobante_media_id, comprobante_hash,
        estado_validacion, motivo_validacion,
        ocr_text_raw, ocr_monto, ocr_referencia, ocr_fecha, ocr_hora, ocr_banco, ocr_fingerprint
      ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5,
        'https://seed.local', 'seed_media', $6,
        'valido', 'seed_ocr_dup_test',
        'seed text', NULL, 'E2EREF123456', NULL, NULL, NULL, NULL)`,
      [empresaId, seedCid, seedSid, channelId, seedFc, seedHash]
    );

    const ocrDupText =
      "Transferencia Itaú\nReferencia: E2EREF123456\nMonto Gs. 1.500.000\nFecha 15/03/2026 10:30\n";

    const r4 = await runComprobanteValidationPipeline({
      supabase,
      empresaId,
      conversationId,
      channelId,
      flowCode,
      flowSessionId: String(flowSessionId),
      mediaId: "tech_test_t4_ocr_dup",
      publicUrl: "https://tech.test/t4.png",
      bytes: pngB,
      mimeType: "image/png",
      settings,
      ocrTextOverride: ocrDupText,
    });

    r4Exitosa =
      r4.kind === "resolved" &&
      r4.estado === "duplicado_ocr" &&
      r4.advance === false &&
      r4.sendInteractive?.body === settings.messages.ocr_duplicado;

    r4Estado = r4.kind === "resolved" ? r4.estado : String(r4.kind);
    r4Motivo = r4.kind === "resolved" ? r4.motivo : "—";
    r4Id = r4.kind === "resolved" ? r4.validationId : "—";
    r4Detalle = `semilla_session=${seedSid}; mensaje_ocr_dup_coincide=${r4Exitosa}`;

    await db.query(`DELETE FROM public.chat_comprobante_validaciones WHERE motivo_validacion = 'seed_ocr_dup_test'`);
  }

  informes.push({
    prueba: "4) Hash distinto + OCR ref duplicada (override texto)",
    exitosa: r4Exitosa,
    ids: { validation_id: r4Id },
    estado_validacion: r4Estado,
    motivo_validacion: r4Motivo,
    hash_sha256: hB,
    ocr_ejecutado: "override con Referencia: E2EREF123456 (misma que semilla DB)",
    cerraria_al_confirmar: cerrariaCompra(r4Estado),
    orden_rpc: "NO",
    detalle: r4Detalle,
  });

  // --- Prueba 5: sospecha OCR corto ---
  const r5 = await runComprobanteValidationPipeline({
    supabase,
    empresaId,
    conversationId,
    channelId,
    flowCode,
    flowSessionId: String(flowSessionId),
    mediaId: "tech_test_t5_sospecha",
    publicUrl: "https://tech.test/t5.png",
    bytes: pngC,
    mimeType: "image/png",
    settings: {
      ...settings,
      ocr_obligatorio: true,
      revision_manual_si_sospecha_ocr: true,
      ocr_min_chars_sospecha: 24,
    },
    ocrTextOverride: "OK",
  });

  const r5Ok =
    r5.kind === "resolved" &&
    r5.estado === "revision_manual" &&
    r5.motivo === "ocr_texto_corto_sospecha";

  informes.push({
    prueba: "5) OCR sospecha (texto corto + obligatorio)",
    exitosa: r5Ok,
    ids: { validation_id: r5.kind === "resolved" ? r5.validationId : "—" },
    estado_validacion: r5.kind === "resolved" ? r5.estado : "—",
    motivo_validacion: r5.kind === "resolved" ? r5.motivo : String(r5.kind),
    hash_sha256: hashOf(pngC),
    ocr_ejecutado: 'override "OK" (2 chars < min 24)',
    cerraria_al_confirmar: r5.kind === "resolved" ? cerrariaCompra(r5.estado) : "NO",
    orden_rpc: "NO",
    detalle: `advance=${r5.kind === "resolved" ? r5.advance : "n/a"}; takeover_config=${settings.revision_manual_activar_takeover}`,
  });

  await db.query(
    `DELETE FROM public.chat_comprobante_validaciones
     WHERE empresa_id = $1::uuid AND comprobante_media_id LIKE 'tech_test_%'`,
    [empresaId]
  );

  printInformes(informes);
  await db.end();
}

function printInformes(rows: Informe[]) {
  console.log("\n========== RESULTADO PRUEBAS TÉCNICAS ==========\n");
  for (const r of rows) {
    console.log(`--- ${r.prueba} ---`);
    console.log("EXITOSA:", r.exitosa ? "SÍ" : "NO");
    if (r.ids) console.log("ids:", JSON.stringify(r.ids));
    if (r.estado_validacion != null) console.log("estado_validacion:", r.estado_validacion);
    if (r.motivo_validacion != null) console.log("motivo_validacion:", r.motivo_validacion);
    if (r.hash_sha256) console.log("hash_sha256:", r.hash_sha256);
    if (r.ocr_ejecutado) console.log("ocr:", r.ocr_ejecutado);
    if (r.cerraria_al_confirmar) console.log("cerraría compra al confirmar (regla código):", r.cerraria_al_confirmar);
    if (r.orden_rpc) console.log("orden/cupones (RPC finalize):", r.orden_rpc);
    if (r.detalle) console.log("detalle:", r.detalle);
    console.log("");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
