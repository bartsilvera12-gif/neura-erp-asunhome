/**
 * E2E sorteo vía DB + motor de flujo (.env.local, service role).
 * npx tsx scripts/e2e-sorteo-flow-from-db.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  advanceConversationToNode,
  getConversationFlowState,
  processInteractiveReply,
  processTextReply,
  sendCurrentFlowNode,
} from "../src/lib/chat/flow-engine-service";
import { insertActiveFlowSessionRow } from "../src/lib/chat/flow-session-service";
import { getFirstActiveNodeCodeForFlow } from "../src/lib/chat/resolve-whatsapp-active-flow";
import {
  optionPayloadFinalizesSorteoOrder,
  SORTEO_COMPROBANTE_MEDIA_ID_FIELD,
  SORTEO_COMPROBANTE_URL_FIELD,
} from "../src/lib/sorteos/sorteo-order-from-chat";

const CHAT_MEDIA_BUCKET = "chat-media";

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

type FlowNodeRow = {
  id: string;
  node_code: string;
  node_type: string;
  save_as_field: string | null;
  next_node_code: string | null;
  message_text: string | null;
};

type FlowOptRow = {
  id: string;
  label: string;
  option_value: string;
  meta_button_id: string;
  next_node_code: string | null;
  sort_order: number;
  option_payload: Record<string, unknown> | null;
};

function logSection(title: string) {
  console.log("\n=== " + title + " ===");
}

async function getNode(
  sb: SupabaseClient,
  empresaId: string,
  flowCode: string,
  nodeCode: string
): Promise<FlowNodeRow | null> {
  const { data, error } = await sb
    .from("chat_flow_nodes")
    .select("id, node_code, node_type, save_as_field, next_node_code, message_text")
    .eq("empresa_id", empresaId)
    .eq("flow_code", flowCode)
    .eq("node_code", nodeCode)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as FlowNodeRow) ?? null;
}

async function getOptions(sb: SupabaseClient, nodeId: string): Promise<FlowOptRow[]> {
  const { data, error } = await sb
    .from("chat_flow_options")
    .select("id, label, option_value, meta_button_id, next_node_code, sort_order, option_payload")
    .eq("node_id", nodeId)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as FlowOptRow[];
}

async function readFlowDataMap(
  sb: SupabaseClient,
  empresaId: string,
  conversationId: string,
  flowCode: string,
  flowSessionId: string
): Promise<Record<string, string>> {
  const { data, error } = await sb
    .from("chat_flow_data")
    .select("field_name, field_value")
    .eq("empresa_id", empresaId)
    .eq("conversation_id", conversationId)
    .eq("flow_code", flowCode)
    .eq("flow_session_id", flowSessionId);
  if (error) throw new Error(error.message);
  const out: Record<string, string> = {};
  for (const row of data ?? []) {
    const k = String((row as { field_name?: string }).field_name ?? "").trim();
    if (!k) continue;
    out[k] = String((row as { field_value?: string }).field_value ?? "");
  }
  return out;
}

function textForSaveField(field: string): string {
  const f = field.trim().toLowerCase();
  if (f === "nombre" || f === "nombre_cliente") return "E2E";
  if (f === "apellido" || f === "apellido_cliente") return "SorteoTest";
  if (f.includes("cedula") || f.includes("cédula") || f === "ci" || f === "documento") return "4012345";
  if (f.includes("ciudad")) return "Asunción";
  if (f.includes("telefono") || f.includes("teléfono")) return "0981000999";
  return `e2e_${f.slice(0, 20)}`;
}

function optionHasCantidadPayload(op: FlowOptRow): boolean {
  const p = op.option_payload;
  if (!p || typeof p !== "object") return false;
  const o = p as Record<string, unknown>;
  for (const k of ["cantidad", "cantidad_boletos", "qty", "quantity", "boletos"]) {
    const v = o[k];
    if (v == null) continue;
    const n = Number(String(v).replace(",", "."));
    if (Number.isFinite(n) && n >= 1) return true;
  }
  return false;
}

async function ensureBucket(sb: SupabaseClient) {
  const { data: buckets, error: listErr } = await sb.storage.listBuckets();
  if (listErr) throw new Error(listErr.message);
  const exists = (buckets ?? []).some((b) => b.name === CHAT_MEDIA_BUCKET);
  if (!exists) {
    const { error: createErr } = await sb.storage.createBucket(CHAT_MEDIA_BUCKET, {
      public: true,
      fileSizeLimit: "10MB",
    });
    if (createErr && !String(createErr.message).toLowerCase().includes("already")) {
      throw new Error(createErr.message);
    }
  }
}

async function simulateComprobanteStep(params: {
  sb: SupabaseClient;
  empresaId: string;
  conversationId: string;
  flowCode: string;
  flowSessionId: string;
  imageNode: FlowNodeRow;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { sb, empresaId, conversationId, flowCode, flowSessionId, imageNode } = params;
  if (!imageNode.next_node_code) {
    return { ok: false, error: "nodo image_input sin next_node_code" };
  }
  try {
    await ensureBucket(sb);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const path = `${empresaId}/${conversationId}/${Date.now()}-e2e-comprobante.png`;
  const up = await sb.storage.from(CHAT_MEDIA_BUCKET).upload(path, PNG_1PX, {
    contentType: "image/png",
    upsert: true,
  });
  if (up.error) {
    return { ok: false, error: `storage.upload: ${up.error.message}` };
  }
  const publicUrl = sb.storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
  const mediaId = `e2e_wa_media_${Date.now()}`;

  const rows: Array<{
    empresa_id: string;
    conversation_id: string;
    flow_code: string;
    flow_session_id: string;
    field_name: string;
    field_value: string;
  }> = [
    {
      empresa_id: empresaId,
      conversation_id: conversationId,
      flow_code: flowCode,
      flow_session_id: flowSessionId,
      field_name: SORTEO_COMPROBANTE_MEDIA_ID_FIELD,
      field_value: mediaId,
    },
    {
      empresa_id: empresaId,
      conversation_id: conversationId,
      flow_code: flowCode,
      flow_session_id: flowSessionId,
      field_name: SORTEO_COMPROBANTE_URL_FIELD,
      field_value: publicUrl,
    },
  ];
  const saf = imageNode.save_as_field?.trim();
  if (saf) {
    rows.push({
      empresa_id: empresaId,
      conversation_id: conversationId,
      flow_code: flowCode,
      flow_session_id: flowSessionId,
      field_name: saf,
      field_value: publicUrl,
    });
  }
  const { error: upErr } = await sb.from("chat_flow_data").upsert(rows, {
    onConflict: "flow_session_id,field_name",
  });
  if (upErr) {
    return { ok: false, error: `chat_flow_data comprobante: ${upErr.message}` };
  }

  await sb.from("chat_flow_events").insert({
    empresa_id: empresaId,
    conversation_id: conversationId,
    flow_code: flowCode,
    node_code: imageNode.node_code,
    flow_session_id: flowSessionId,
    event_type: "image_received",
    payload: {
      media_id: mediaId,
      mime_type: "image/png",
      storage_url: publicUrl,
      sorteo_order_deferred_until_confirm: true,
      e2e_simulated: true,
    },
  });

  const adv = await advanceConversationToNode(sb, {
    conversationId,
    empresaId,
    flowCode,
    nextNodeCode: imageNode.next_node_code,
  });
  if (!adv.ok) {
    return { ok: false, error: adv.error ?? "advance después de comprobante" };
  }

  await sb.from("chat_flow_events").insert({
    empresa_id: empresaId,
    conversation_id: conversationId,
    flow_code: flowCode,
    node_code: imageNode.next_node_code,
    flow_session_id: flowSessionId,
    event_type: "node_advanced",
    payload: { from_node: imageNode.node_code, next_node_code: imageNode.next_node_code, reason: "e2e_comprobante" },
  });

  const sent = await sendCurrentFlowNode(sb, {
    conversationId,
    mergeFlowVars: { sorteo_comprobante_url: publicUrl, comprobante_recibido: "sí" },
  });
  if (!sent.ok) {
    return { ok: false, error: `sendCurrentFlowNode post-comprobante: ${sent.error}` };
  }
  return { ok: true };
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  logSection("Descubrir flujo con sorteo");
  const { data: flowRow, error: flowErr } = await sb
    .from("chat_flows")
    .select("empresa_id, flow_code, sorteo_id")
    .eq("channel", "whatsapp")
    .eq("activo", true)
    .not("sorteo_id", "is", null)
    .limit(5);

  if (flowErr || !flowRow?.length) {
    console.error("FALLO: no hay chat_flows activo whatsapp con sorteo_id.", flowErr?.message ?? "");
    process.exit(2);
  }

  let picked: { empresa_id: string; flow_code: string; sorteo_id: string } | null = null;
  for (const r of flowRow as { empresa_id: string; flow_code: string; sorteo_id: string }[]) {
    const { data: s } = await sb
      .from("sorteos")
      .select("id, estado")
      .eq("id", r.sorteo_id)
      .maybeSingle();
    if (s && (s as { estado?: string }).estado === "activo") {
      picked = r;
      break;
    }
  }
  if (!picked) {
    console.error("FALLO: ningún sorteo_id vinculado está activo.");
    process.exit(2);
  }

  const empresaId = picked.empresa_id;
  const flowCode = picked.flow_code.trim();
  const sorteoId = picked.sorteo_id;

  console.log("empresa_id:", empresaId);
  console.log("flow_code:", flowCode);
  console.log("sorteo_id:", sorteoId);

  const { data: channel, error: chErr } = await sb
    .from("chat_channels")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("type", "whatsapp")
    .eq("activo", true)
    .limit(1)
    .maybeSingle();
  if (chErr || !channel) {
    console.error("FALLO: sin chat_channels whatsapp para empresa.", chErr?.message ?? "");
    process.exit(2);
  }
  const channelId = (channel as { id: string }).id;

  const firstNode =
    (await getFirstActiveNodeCodeForFlow(sb, empresaId, flowCode)) || "inicio";
  const phone = `5959819${String(Math.floor(100000 + Math.random() * 900000))}`;

  logSection("Crear contacto + conversación + sesión");
  const { data: contact, error: ctErr } = await sb
    .from("chat_contacts")
    .upsert(
      {
        empresa_id: empresaId,
        phone_number: phone,
        phone_normalized: phone,
        name: `E2E ${phone}`,
      },
      { onConflict: "empresa_id,phone_number" }
    )
    .select("id")
    .single();
  if (ctErr || !contact) {
    console.error("FALLO: contacto.", ctErr?.message ?? "");
    process.exit(2);
  }
  const contactId = (contact as { id: string }).id;

  const { data: conv, error: cvErr } = await sb
    .from("chat_conversations")
    .insert({
      empresa_id: empresaId,
      channel_id: channelId,
      contact_id: contactId,
      status: "open",
      flow_code: flowCode,
      flow_current_node: firstNode,
      flow_status: "bot",
      human_taken_over: false,
      unread_count: 0,
    })
    .select("id")
    .single();
  if (cvErr || !conv) {
    console.error("FALLO: conversación.", cvErr?.message ?? "");
    process.exit(2);
  }
  const conversationId = (conv as { id: string }).id;

  const flowSessionId = await insertActiveFlowSessionRow(sb, empresaId, conversationId, flowCode);
  if (!flowSessionId) {
    console.error("FALLO: insertActiveFlowSessionRow devolvió null");
    process.exit(2);
  }
  await sb
    .from("chat_conversations")
    .update({ active_flow_session_id: flowSessionId, updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("empresa_id", empresaId);

  console.log("conversation_id:", conversationId);
  console.log("flow_session_id:", flowSessionId);
  console.log("teléfono ficticio:", phone);

  logSection("Paso: mensaje inicial (sendCurrentFlowNode)");
  const s0 = await sendCurrentFlowNode(sb, { conversationId });
  if (!s0.ok) {
    console.error("FALLO paso inicial:", s0.error);
    console.error(
      JSON.stringify(
        {
          resultado: "FALLIDA",
          paso: "sendCurrentFlowNode_inicial",
          funcion: "sendCurrentFlowNode",
          error: s0.error ?? null,
          conversation_id: conversationId,
          flow_session_id: flowSessionId,
        },
        null,
        2
      )
    );
    process.exit(3);
  }
  console.log("OK nodo enviado:", s0.nodeCode);

  let step = 0;
  let lastInteractiveStatus = "";
  /** Si el nodo de confirmación no tiene option_payload de cierre sorteo. */
  let missingFinalizePayloadOnConfirm: string | null = null;
  while (step++ < 45) {
    const state = await getConversationFlowState(sb, conversationId);
    if (!state?.flow_current_node || !state.flow_code) {
      console.error("FALLO: estado sin nodo");
      process.exit(4);
    }
    const node = await getNode(sb, empresaId, state.flow_code, state.flow_current_node);
    if (!node) {
      console.error("FALLO: nodo no encontrado", state.flow_current_node);
      process.exit(4);
    }

    console.log(`\n[iter ${step}] nodo=${node.node_code} type=${node.node_type}`);

    if (node.node_type === "end" || node.node_type === "human") {
      console.log("Fin flujo (end/human).");
      break;
    }

    if (node.node_type === "text") {
      const saf = node.save_as_field?.trim();
      if (saf) {
        const txt = textForSaveField(saf);
        const tr = await processTextReply(sb, {
          conversationId,
          empresaId,
          textValue: txt,
          rawPayload: { e2e: true },
        });
        if (!tr.ok) {
          console.error(
            JSON.stringify(
              {
                resultado: "FALLIDA",
                paso: "processTextReply",
                nodo: node.node_code,
                save_as_field: saf,
                funcion: "processTextReply",
                status: tr.status,
                error: tr.error ?? null,
                conversation_id: conversationId,
                flow_session_id: flowSessionId,
              },
              null,
              2
            )
          );
          process.exit(5);
        }
        console.log("OK text capture:", tr.status, "→", tr.nextNodeCode);
        continue;
      }
      if (node.next_node_code) {
        console.log("Nodo texto informativo → avanzar a", node.next_node_code);
        const adv = await advanceConversationToNode(sb, {
          conversationId,
          empresaId,
          flowCode: state.flow_code,
          nextNodeCode: node.next_node_code,
        });
        if (!adv.ok) {
          console.error("FALLO advance texto informativo:", adv.error);
          process.exit(5);
        }
        await sb.from("chat_flow_events").insert({
          empresa_id: empresaId,
          conversation_id: conversationId,
          flow_code: state.flow_code,
          node_code: node.next_node_code,
          flow_session_id: state.active_flow_session_id ?? flowSessionId,
          event_type: "node_advanced",
          payload: {
            from_node: node.node_code,
            next_node_code: node.next_node_code,
            reason: "e2e_text_info_skip",
          },
        });
        const sent = await sendCurrentFlowNode(sb, { conversationId });
        if (!sent.ok) {
          console.error("FALLO send tras texto informativo:", sent.error);
          process.exit(5);
        }
        continue;
      }
      console.log("Fin: nodo texto sin captura ni next:", node.node_code);
      break;
    }

    if (node.node_type === "image_input") {
      const sim = await simulateComprobanteStep({
        sb,
        empresaId,
        conversationId,
        flowCode: state.flow_code,
        flowSessionId: state.active_flow_session_id ?? flowSessionId,
        imageNode: node,
      });
      if (!sim.ok) {
        console.error(
          JSON.stringify(
            {
              resultado: "FALLIDA",
              paso: "simular_comprobante",
              nodo: node.node_code,
              error: sim.error,
              conversation_id: conversationId,
              flow_session_id: flowSessionId,
            },
            null,
            2
          )
        );
        process.exit(6);
      }
      console.log("OK comprobante simulado + avanzado");
      continue;
    }

    if (node.node_type === "buttons" || node.node_type === "list") {
      const options = await getOptions(sb, node.id);
      if (!options.length) {
        console.error("FALLO: nodo interactivo sin opciones");
        process.exit(7);
      }

      const finalizeOpts = options.filter((o) => optionPayloadFinalizesSorteoOrder(o.option_payload));
      const fd = await readFlowDataMap(
        sb,
        empresaId,
        conversationId,
        state.flow_code,
        state.active_flow_session_id ?? flowSessionId
      );
      const hasUrl = Boolean((fd[SORTEO_COMPROBANTE_URL_FIELD] ?? "").trim());
      const hasNombre = Boolean((fd["nombre"] ?? "").trim() || (fd["nombre_completo"] ?? "").trim());
      const hasCedula = Boolean((fd["cedula"] ?? "").trim());
      const looksLikeConfirmNode =
        /confirm/i.test(node.node_code) ||
        options.some((o) => /confirm/i.test(o.label) || /confirm/i.test(o.meta_button_id));

      let chosen: FlowOptRow;
      if (finalizeOpts.length > 0 && hasUrl) {
        chosen = finalizeOpts[0]!;
        console.log("Elegir confirmación final:", chosen.label, chosen.meta_button_id);
      } else {
        const nonFin = options.filter((o) => !optionPayloadFinalizesSorteoOrder(o.option_payload));
        const withQty = nonFin.find(optionHasCantidadPayload);
        chosen = withQty ?? nonFin[0] ?? options[0]!;
        console.log("Elegir opción compra/menú:", chosen.label, chosen.meta_button_id);
      }

      if (
        finalizeOpts.length === 0 &&
        hasUrl &&
        hasNombre &&
        hasCedula &&
        looksLikeConfirmNode &&
        optionPayloadFinalizesSorteoOrder(chosen.option_payload) === false
      ) {
        missingFinalizePayloadOnConfirm = `${node.node_code} / ${chosen.meta_button_id}`;
        console.warn(
          "[e2e] ADVERTENCIA: nodo de confirmación con comprobante y datos pero ninguna opción lleva confirmar_orden_sorteo (o equivalente) en option_payload."
        );
      }

      const ir = await processInteractiveReply(sb, {
        conversationId,
        empresaId,
        metaButtonId: chosen.meta_button_id,
        rawPayload: { e2e: true },
      });
      lastInteractiveStatus = ir.status;
      if (!ir.ok) {
        console.error(
          JSON.stringify(
            {
              resultado: "FALLIDA",
              paso: "processInteractiveReply",
              nodo: node.node_code,
              meta_button_id: chosen.meta_button_id,
              funcion: "processInteractiveReply",
              status: ir.status,
              error: ir.error ?? null,
              conversation_id: conversationId,
              flow_session_id: flowSessionId,
            },
            null,
            2
          )
        );
        process.exit(8);
      }
      console.log("OK interactive:", ir.status, "→", ir.nextNodeCode);

      if (finalizeOpts.length > 0 && chosen === finalizeOpts[0] && hasUrl) {
        console.log("Confirmación final procesada; saliendo del bucle.");
        break;
      }
      continue;
    }

    console.error("FALLO: tipo de nodo no manejado:", node.node_type, node.node_code);
    process.exit(9);
  }

  logSection("chat_flow_data final");
  const stateEnd = await getConversationFlowState(sb, conversationId);
  const fdFinal = await readFlowDataMap(
    sb,
    empresaId,
    conversationId,
    flowCode,
    stateEnd?.active_flow_session_id ?? flowSessionId
  );
  console.log(JSON.stringify(fdFinal, null, 2));

  logSection("sorteo_entradas + cupones");
  const { data: entradas, error: enErr } = await sb
    .from("sorteo_entradas")
    .select(
      "id, sorteo_id, chat_conversation_id, cantidad_boletos, monto_total, numero_orden, nombre_participante, documento, estado_pago, comprobante_url, flow_code"
    )
    .eq("chat_conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(3);

  if (enErr) {
    console.error("Error leyendo sorteo_entradas:", enErr.message);
    process.exit(10);
  }
  console.log("entradas (hasta 3):", JSON.stringify(entradas ?? [], null, 2));

  const entradaId = (entradas?.[0] as { id?: string } | undefined)?.id;
  let cupones: unknown[] = [];
  if (entradaId) {
    const { data: cups, error: cuErr } = await sb
      .from("sorteo_cupones")
      .select("id, entrada_id, numero_cupon")
      .eq("entrada_id", entradaId)
      .order("numero_cupon", { ascending: true });
    if (cuErr) {
      console.error("Error cupones:", cuErr.message);
      process.exit(11);
    }
    cupones = cups ?? [];
  }
  console.log("cupones:", JSON.stringify(cupones, null, 2));

  const okOrder = Boolean(entradaId && cupones.length > 0);
  const qtyExpected = Number(fdFinal["sorteo_snap_cantidad"] || fdFinal["cantidad"] || fdFinal["cantidad_boletos"]);
  const ent = entradas?.[0] as
    | { cantidad_boletos?: number; monto_total?: number; nombre_participante?: string }
    | undefined;

  logSection("RESULTADO");
  if (missingFinalizePayloadOnConfirm) {
    console.log("CONFIG_FLUJO: falta option_payload de cierre sorteo en:", missingFinalizePayloadOnConfirm);
  }

  if (okOrder) {
    console.log("PRUEBA: EXITOSA");
    console.log("conversation_id:", conversationId);
    console.log("flow_session_id:", flowSessionId);
    console.log("último processInteractiveReply status:", lastInteractiveStatus);
    if (Number.isFinite(qtyExpected) && ent?.cantidad_boletos != null) {
      console.log(
        "coincidencia cantidad (flow_data vs entrada):",
        qtyExpected,
        "vs",
        ent.cantidad_boletos,
        qtyExpected === ent.cantidad_boletos ? "OK" : "REVISAR"
      );
    }
  } else {
    console.log("PRUEBA: FALLIDA (sin entrada o sin cupones para esta conversación)");
    console.log("conversation_id:", conversationId);
    console.log("flow_session_id:", flowSessionId);
    if (missingFinalizePayloadOnConfirm) {
      console.log(
        "CAUSA: processInteractiveReply no ejecutó finalizeSorteoOrderFromConfirmedFlowData porque el botón de confirmación no tiene confirmar_orden_sorteo / finalize_sorteo_order / cerrar_compra_sorteo en option_payload."
      );
      console.log("PASO_FALLIDO: confirmación final (motor sorteo no invocado).");
    }
    process.exit(12);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
