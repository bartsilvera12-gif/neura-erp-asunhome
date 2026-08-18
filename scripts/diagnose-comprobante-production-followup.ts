/**
 * Seguimiento producción: matcheo previo por referencia/huella/hash y resumen diario.
 * Solo SELECT. Sin writes.
 *
 * Usa las mismas vars que diagnose-sorteo-comprobante-duplicate + opcional:
 *   CHAT_DIAGNOSE_DAY_START  (default 2026-05-03T00:00:00-04:00)
 *   CHAT_DIAGNOSE_DAY_END    (default 2026-05-04T00:00:00-04:00)
 */
import { config } from "dotenv";
import path from "node:path";
import pg from "pg";

config({ path: path.resolve(process.cwd(), ".env.local") });

const url =
  process.env.SUPABASE_DB_URL?.trim() ||
  process.env.DIRECT_URL?.trim() ||
  process.env.DATABASE_URL?.trim();
const schema = process.env.CHAT_DIAGNOSE_SCHEMA?.trim() ?? "erp_el_papu_store_5ad0bdda";
const empresaId = process.env.CHAT_DIAGNOSE_EMPRESA_ID?.trim() ?? "5ad0bdda-f94f-446c-9032-1fedf34e8479";
const phoneHint = process.env.CHAT_DIAGNOSE_PHONE?.trim() ?? "595981462835";
const dayStart = process.env.CHAT_DIAGNOSE_DAY_START?.trim() ?? "2026-05-03T00:00:00-04:00";
const dayEnd = process.env.CHAT_DIAGNOSE_DAY_END?.trim() ?? "2026-05-04T00:00:00-04:00";

function qt(name: string): string {
  return `"${schema.replace(/"/g, "")}".${name}`;
}

async function main() {
  if (!url) {
    console.error("Falta DATABASE_URL / SUPABASE_DB_URL");
    process.exit(1);
  }

  const client = new pg.Client({
    connectionString: url,
    ssl: url.includes("supabase") ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  try {
    const convMathias =
      "eb42990d-0059-4e45-b417-141cb18ce221" as const;
    const imgMsg =
      "5497f471-cd92-4841-b12f-e031f5a9d258" as const;

    const refRows = await client.query(
      `
      SELECT id::text, conversation_id::text, flow_session_id::text, estado_validacion::text,
             motivo_validacion::text, comprobante_hash::text, comprobante_media_id::text,
             ocr_referencia::text, ocr_fingerprint::text,
             length(coalesce(ocr_text_raw,''))::int AS ocr_text_len,
             created_at
      FROM ${qt("chat_comprobante_validaciones")}
      WHERE empresa_id = $1::uuid AND conversation_id = $2::uuid
      ORDER BY created_at DESC
      `,
      [empresaId, convMathias]
    );
    console.log("[followup][mathias_validaciones]", refRows.rows);

    const refVal = String(
      (refRows.rows[0] as { ocr_referencia?: string } | undefined)?.ocr_referencia ?? ""
    ).trim();
    const strongRef = refVal.length >= 12;

    if (refVal) {
      const olderSameRef = await client.query(
        `
        SELECT v.id::text, v.conversation_id::text, v.flow_session_id::text, v.estado_validacion::text,
               v.motivo_validacion::text, v.created_at,
               cc.phone_number::text, cc.name::text,
               v.flow_code::text
        FROM ${qt("chat_comprobante_validaciones")} v
        LEFT JOIN ${qt("chat_conversations")} c ON c.id = v.conversation_id AND c.empresa_id = v.empresa_id
        LEFT JOIN ${qt("chat_contacts")} cc ON cc.id = c.contact_id AND cc.empresa_id = v.empresa_id
        WHERE v.empresa_id = $1::uuid
          AND upper(trim(coalesce(v.ocr_referencia,''))) = upper(trim($2::text))
          AND v.estado_validacion = 'valido'
        ORDER BY v.created_at ASC
        LIMIT 25
        `,
        [empresaId, refVal]
      );
      console.log("[followup][mismo_ocr_referencia_valido_orden_cronologico]", {
        referencia: refVal,
        ref_len: refVal.length,
        ref_eligible_strong_duplicate_after_commit_ref12: strongRef,
        rows: olderSameRef.rows,
      });

      const firstMatcher = olderSameRef.rows[0] as
        | {
            id?: string;
            conversation_id?: string;
            phone_number?: string;
            name?: string;
            sorteo_id?: string;
            created_at?: Date;
          }
        | undefined;

      const mathiasRows = refRows.rows as Array<{ id?: string; created_at?: Date }>;
      const earliestDup = mathiasRows.filter((r) => r.id)?.map((r) => r.id);

      console.log("[followup][interpretacion_mathias]", {
        mensaje_bot_coincidencia: "Anterior row valido con misma ocr_referencia en otra conversación/sesión → existsOcrRefDuplicate (pre 8e42c07).",
        misma_referencia_extraida: refVal,
        fingerprint_en_filas_mathias_vacio: "Si fp_prefix vacío, el bloqueo no fue por huella OCR en DB (o no se persistió fingerprint).",
        registro_anterior_probable: firstMatcher ?? "ninguno valido encontrado antes en esta query",
      });
    }

    const imgMeta = await client.query(
      `
      SELECT id::text, message_type::text, created_at,
             raw_payload->'image'->>'id' AS wa_media_id,
             substring(coalesce(raw_payload::text,''), 1, 200) AS raw_head
      FROM ${qt("chat_messages")}
      WHERE id = $1::uuid AND empresa_id = $2::uuid
      `,
      [imgMsg, empresaId]
    );
    console.log("[followup][mathias_image_message]", imgMeta.rows);

    const byEstadoDay = await client.query(
      `
      SELECT estado_validacion::text, COUNT(*)::int AS n
      FROM ${qt("chat_comprobante_validaciones")}
      WHERE empresa_id = $1::uuid
        AND created_at >= $2::timestamptz AND created_at < $3::timestamptz
      GROUP BY estado_validacion
      ORDER BY n DESC
      `,
      [empresaId, dayStart, dayEnd]
    );
    console.log("[followup][dia_por_estado]", { dayStart, dayEnd, rows: byEstadoDay.rows });

    const byMotivoDay = await client.query(
      `
      SELECT coalesce(motivo_validacion,'(null)')::text AS motivo, COUNT(*)::int AS n
      FROM ${qt("chat_comprobante_validaciones")}
      WHERE empresa_id = $1::uuid
        AND created_at >= $2::timestamptz AND created_at < $3::timestamptz
        AND estado_validacion IN ('duplicado_ocr','revision_manual','duplicado_hash','ocr_error')
      GROUP BY motivo_validacion
      ORDER BY n DESC
      `,
      [empresaId, dayStart, dayEnd]
    );
    console.log("[followup][dia_por_motivo_filtrado]", byMotivoDay.rows);

    const dupOcrDay = await client.query(
      `
      SELECT COUNT(*)::int AS n
      FROM ${qt("chat_comprobante_validaciones")}
      WHERE empresa_id = $1::uuid
        AND created_at >= $2::timestamptz AND created_at < $3::timestamptz
        AND estado_validacion = 'duplicado_ocr'
      `,
      [empresaId, dayStart, dayEnd]
    );

    const refRep = await client.query(
      `
      SELECT upper(trim(ocr_referencia)) AS ref, COUNT(*)::int AS n,
             COUNT(DISTINCT conversation_id)::int AS distinct_conversations
      FROM ${qt("chat_comprobante_validaciones")}
      WHERE empresa_id = $1::uuid
        AND created_at >= $2::timestamptz AND created_at < $3::timestamptz
        AND estado_validacion = 'duplicado_ocr'
        AND ocr_referencia IS NOT NULL AND length(trim(ocr_referencia)) > 0
      GROUP BY upper(trim(ocr_referencia))
      HAVING COUNT(*) > 1
      ORDER BY n DESC
      LIMIT 30
      `,
      [empresaId, dayStart, dayEnd]
    );
    console.log("[followup][dia_duplicado_ocr_referencia_repetida]", refRep.rows);

    const fpRep = await client.query(
      `
      SELECT ocr_fingerprint AS fp, COUNT(*)::int AS n
      FROM ${qt("chat_comprobante_validaciones")}
      WHERE empresa_id = $1::uuid
        AND created_at >= $2::timestamptz AND created_at < $3::timestamptz
        AND estado_validacion = 'duplicado_ocr'
        AND ocr_fingerprint IS NOT NULL AND length(trim(ocr_fingerprint)) > 0
      GROUP BY ocr_fingerprint
      HAVING COUNT(*) > 1
      ORDER BY n DESC
      LIMIT 20
      `,
      [empresaId, dayStart, dayEnd]
    );
    console.log("[followup][dia_duplicado_ocr_fingerprint_repetido]", fpRep.rows);

    const hashRep = await client.query(
      `
      SELECT comprobante_hash AS h, COUNT(*)::int AS n,
             COUNT(DISTINCT conversation_id)::int AS distinct_conv
      FROM ${qt("chat_comprobante_validaciones")}
      WHERE empresa_id = $1::uuid
        AND created_at >= $2::timestamptz AND created_at < $3::timestamptz
        AND estado_validacion = 'duplicado_hash'
      GROUP BY comprobante_hash
      HAVING COUNT(*) > 1
      ORDER BY n DESC
      LIMIT 15
      `,
      [empresaId, dayStart, dayEnd]
    );
    console.log("[followup][dia_duplicado_hash_repetido]", hashRep.rows);

    const phonesDupOcr = await client.query(
      `
      SELECT regexp_replace(coalesce(cc.phone_number,''), '\\D', '', 'g') AS phone_digits,
             COUNT(DISTINCT v.conversation_id)::int AS conversations
      FROM ${qt("chat_comprobante_validaciones")} v
      JOIN ${qt("chat_conversations")} c ON c.id = v.conversation_id AND c.empresa_id = v.empresa_id
      LEFT JOIN ${qt("chat_contacts")} cc ON cc.id = c.contact_id AND cc.empresa_id = v.empresa_id
      WHERE v.empresa_id = $1::uuid
        AND v.created_at >= $2::timestamptz AND v.created_at < $3::timestamptz
        AND v.estado_validacion = 'duplicado_ocr'
      GROUP BY regexp_replace(coalesce(cc.phone_number,''), '\\D', '', 'g')
      ORDER BY conversations DESC
      LIMIT 40
      `,
      [empresaId, dayStart, dayEnd]
    );
    console.log("[followup][dia_duplicado_ocr_por_telefono_distinto]", phonesDupOcr.rows);

    const revisionHuella = await client.query(
      `
      SELECT COUNT(*)::int AS n
      FROM ${qt("chat_comprobante_validaciones")}
      WHERE empresa_id = $1::uuid
        AND created_at >= $2::timestamptz AND created_at < $3::timestamptz
        AND estado_validacion = 'revision_manual'
        AND motivo_validacion LIKE 'ocr_huella%'
      `,
      [empresaId, dayStart, dayEnd]
    );

    console.log("[followup][resumen_candidatos_falso_positivo]", {
      duplicado_ocr_en_dia: dupOcrDay.rows[0]?.n ?? 0,
      nota_pre_fix:
        "Filas con motivo ocr_duplicado_referencia_o_huella son PRE 8e42c07; post-fix motivos separados.",
      revision_manual_por_huella_post_fix_esperado: revisionHuella.rows[0]?.n ?? 0,
      heuristica_fp_vacio_or_dup_ref_corta:
        "Si duplicado_ocr con mismo ocr_referencia en muchas conversaciones → ref genérica (ej. mismo dígito en extractos).",
    });

    console.log("[followup][estrategia_revision]", {
      paso1: "Filtrar duplicado_ocr del día con motivo antiguo y ocr_referencia repetida entre conversaciones distintas.",
      paso2: "Validar manualmente contra imagen/hash; si archivos distintos → falso positivo histórico.",
      paso3: "No aprobar en masa; reenviar comprobante nuevo o marcar valido tras revisión humana.",
    });
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
