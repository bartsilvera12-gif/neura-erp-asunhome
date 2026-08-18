/**
 * TEST 2: mismo número / misma conversación, dos compras completas con sesiones distintas.
 * npx tsx scripts/e2e-sorteo-two-purchases-same-phone.ts
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
import {
  getFirstActiveNodeCodeForFlow,
  restartWhatsappConversationToFlowStart,
} from "../src/lib/chat/resolve-whatsapp-active-flow";
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

function textForProfile(profile: "p1" | "p2", field: string): string {
  const f = field.trim().toLowerCase();
  if (profile === "p1") {
    if (f === "nombre" || f === "nombre_cliente") return "E2E";
    if (f === "apellido" || f === "apellido_cliente") return "CompraUno";
    if (f.includes("cedula") || f.includes("cédula") || f === "ci" || f === "documento") return "4011111";
  } else {
    if (f === "nombre" || f === "nombre_cliente") return "E2E";
    if (f === "apellido" || f === "apellido_cliente") return "CompraDos";
    if (f.includes("cedula") || f.includes("cédula") || f === "ci" || f === "documento") return "4022222";
  }
  if (f.includes("ciudad")) return "Asunción";
  if (f.includes("telefono") || f.includes("teléfono")) return "0981000999";
  return `e2e_${profile}_${f.slice(0, 16)}`;
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
  tag: string;
}): Promise<{ ok: true; mediaId: string; publicUrl: string } | { ok: false; error: string }> {
  const { sb, empresaId, conversationId, flowCode, flowSessionId, imageNode, tag } = params;
  if (!imageNode.next_node_code) {
    return { ok: false, error: "nodo image_input sin next_node_code" };
  }
  try {
    await ensureBucket(sb);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const path = `${empresaId}/${conversationId}/${Date.now()}-${tag}-e2e.png`;
  const up = await sb.storage.from(CHAT_MEDIA_BUCKET).upload(path, PNG_1PX, {
    contentType: "image/png",
    upsert: true,
  });
  if (up.error) {
    return { ok: false, error: `storage.upload: ${up.error.message}` };
  }
  const publicUrl = sb.storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
  const mediaId = `e2e_${tag}_${Date.now()}`;

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
      tag,
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
    payload: {
      from_node: imageNode.node_code,
      next_node_code: imageNode.next_node_code,
      reason: `e2e_comprobante_${tag}`,
    },
  });

  const sent = await sendCurrentFlowNode(sb, {
    conversationId,
    mergeFlowVars: { sorteo_comprobante_url: publicUrl, comprobante_recibido: "sí" },
  });
  if (!sent.ok) {
    return { ok: false, error: `sendCurrentFlowNode post-comprobante: ${sent.error}` };
  }
  return { ok: true, mediaId, publicUrl };
}

type RunPurchaseParams = {
  sb: SupabaseClient;
  empresaId: string;
  conversationId: string;
  flowCode: string;
  purchaseMetaButtonId: string;
  textProfile: "p1" | "p2";
  label: string;
};

async function runOneCompletePurchase(
  p: RunPurchaseParams
): Promise<{ flowSessionId: string; entradaId: string; cuponCount: number }> {
  const { sb, empresaId, conversationId, flowCode, purchaseMetaButtonId, textProfile, label } = p;

  const state0 = await getConversationFlowState(sb, conversationId);
  const startSid = state0?.active_flow_session_id?.trim();
  if (!startSid) throw new Error(`${label}: sin active_flow_session_id`);

  logSection(`${label}: sendCurrentFlowNode inicial`);
  const s0 = await sendCurrentFlowNode(sb, { conversationId });
  if (!s0.ok) throw new Error(`${label}: sendCurrentFlowNode inicial: ${s0.error}`);

  let step = 0;
  while (step++ < 50) {
    const state = await getConversationFlowState(sb, conversationId);
    if (!state?.flow_current_node || !state.flow_code) {
      throw new Error(`${label}: estado sin nodo`);
    }
    const sid = state.active_flow_session_id?.trim() ?? startSid;
    const node = await getNode(sb, empresaId, state.flow_code, state.flow_current_node);
    if (!node) throw new Error(`${label}: nodo no encontrado ${state.flow_current_node}`);

    console.log(`[${label} iter ${step}] nodo=${node.node_code} type=${node.node_type} sid=${sid}`);

    if (node.node_type === "end" || node.node_type === "human") {
      break;
    }

    if (node.node_type === "text") {
      const saf = node.save_as_field?.trim();
      if (saf) {
        const tr = await processTextReply(sb, {
          conversationId,
          empresaId,
          textValue: textForProfile(textProfile, saf),
          rawPayload: { e2e: true, label },
        });
        if (!tr.ok) {
          throw new Error(
            `${label}: processTextReply ${node.node_code}: ${tr.status} ${tr.error ?? ""}`
          );
        }
        continue;
      }
      if (node.next_node_code) {
        const adv = await advanceConversationToNode(sb, {
          conversationId,
          empresaId,
          flowCode: state.flow_code,
          nextNodeCode: node.next_node_code,
        });
        if (!adv.ok) throw new Error(`${label}: advance texto info: ${adv.error}`);
        await sb.from("chat_flow_events").insert({
          empresa_id: empresaId,
          conversation_id: conversationId,
          flow_code: state.flow_code,
          node_code: node.next_node_code,
          flow_session_id: sid,
          event_type: "node_advanced",
          payload: {
            from_node: node.node_code,
            next_node_code: node.next_node_code,
            reason: `e2e_${label}_text_skip`,
          },
        });
        const sent = await sendCurrentFlowNode(sb, { conversationId });
        if (!sent.ok) throw new Error(`${label}: send tras texto info: ${sent.error}`);
        continue;
      }
      break;
    }

    if (node.node_type === "image_input") {
      const sim = await simulateComprobanteStep({
        sb,
        empresaId,
        conversationId,
        flowCode: state.flow_code,
        flowSessionId: sid,
        imageNode: node,
        tag: label.replace(/\s/g, "_"),
      });
      if (!sim.ok) throw new Error(`${label}: comprobante: ${sim.error}`);
      continue;
    }

    if (node.node_type === "buttons" || node.node_type === "list") {
      const options = await getOptions(sb, node.id);
      if (!options.length) throw new Error(`${label}: sin opciones en ${node.node_code}`);

      const finalizeOpts = options.filter((o) => optionPayloadFinalizesSorteoOrder(o.option_payload));
      const fd = await readFlowDataMap(sb, empresaId, conversationId, state.flow_code, sid);
      const hasUrl = Boolean((fd[SORTEO_COMPROBANTE_URL_FIELD] ?? "").trim());
      const hasNombre = Boolean((fd["nombre"] ?? "").trim() || (fd["nombre_completo"] ?? "").trim());
      const hasCedula = Boolean((fd["cedula"] ?? "").trim());

      let chosen: FlowOptRow;
      if (finalizeOpts.length > 0 && hasUrl) {
        chosen = finalizeOpts[0]!;
        console.log(`[${label}] confirmación final`, chosen.meta_button_id);
      } else {
        const nonFin = options.filter((o) => !optionPayloadFinalizesSorteoOrder(o.option_payload));
        const forced = nonFin.find((o) => o.meta_button_id === purchaseMetaButtonId);
        if (forced) {
          chosen = forced;
          console.log(`[${label}] opción compra forzada`, chosen.label, chosen.meta_button_id);
        } else {
          const withQty = nonFin.find(optionHasCantidadPayload);
          chosen = withQty ?? nonFin[0] ?? options[0]!;
          console.log(`[${label}] opción compra heurística`, chosen.label, chosen.meta_button_id);
        }
      }

      if (
        finalizeOpts.length === 0 &&
        hasUrl &&
        hasNombre &&
        hasCedula &&
        (/confirm/i.test(node.node_code) ||
          options.some((o) => /confirm/i.test(o.label) || /confirm/i.test(o.meta_button_id))) &&
        !optionPayloadFinalizesSorteoOrder(chosen.option_payload)
      ) {
        throw new Error(
          `${label}: botón confirmación sin confirmar_orden_sorteo en ${node.node_code}`
        );
      }

      const ir = await processInteractiveReply(sb, {
        conversationId,
        empresaId,
        metaButtonId: chosen.meta_button_id,
        rawPayload: { e2e: true, label },
      });
      if (!ir.ok) {
        throw new Error(
          `${label}: processInteractiveReply ${chosen.meta_button_id}: ${ir.status} ${ir.error ?? ""}`
        );
      }

      if (finalizeOpts.length > 0 && chosen === finalizeOpts[0] && hasUrl) {
        console.log(`[${label}] compra cerrada`);
        const { data: entRows, error: enErr } = await sb
          .from("sorteo_entradas")
          .select("id")
          .eq("chat_conversation_id", conversationId)
          .order("created_at", { ascending: false })
          .limit(1);
        if (enErr || !entRows?.[0]) {
          throw new Error(`${label}: no se encontró sorteo_entradas tras confirmar`);
        }
        const entradaId = (entRows[0] as { id: string }).id;
        const { count, error: cErr } = await sb
          .from("sorteo_cupones")
          .select("id", { count: "exact", head: true })
          .eq("entrada_id", entradaId);
        if (cErr) throw new Error(`${label}: cupones count: ${cErr.message}`);
        return {
          flowSessionId: startSid,
          entradaId,
          cuponCount: count ?? 0,
        };
      }
      continue;
    }

    throw new Error(`${label}: tipo nodo no manejado ${node.node_type} ${node.node_code}`);
  }

  throw new Error(`${label}: bucle sin cerrar compra`);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: flowRow, error: flowErr } = await sb
    .from("chat_flows")
    .select("empresa_id, flow_code, sorteo_id")
    .eq("channel", "whatsapp")
    .eq("activo", true)
    .not("sorteo_id", "is", null)
    .limit(5);

  if (flowErr || !flowRow?.length) {
    console.error("FALLO: no hay flujo whatsapp con sorteo.", flowErr?.message ?? "");
    process.exit(2);
  }

  let picked: { empresa_id: string; flow_code: string; sorteo_id: string } | null = null;
  for (const r of flowRow as { empresa_id: string; flow_code: string; sorteo_id: string }[]) {
    const { data: s } = await sb.from("sorteos").select("estado").eq("id", r.sorteo_id).maybeSingle();
    if (s && (s as { estado?: string }).estado === "activo") {
      picked = r;
      break;
    }
  }
  if (!picked) {
    console.error("FALLO: sorteo inactivo");
    process.exit(2);
  }

  const empresaId = picked.empresa_id;
  const flowCode = picked.flow_code.trim();

  const { data: channel } = await sb
    .from("chat_channels")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("type", "whatsapp")
    .eq("activo", true)
    .limit(1)
    .maybeSingle();
  if (!channel) {
    console.error("FALLO: sin canal whatsapp");
    process.exit(2);
  }
  const channelId = (channel as { id: string }).id;

  const ofertaNode =
    (await getNode(sb, empresaId, flowCode, "Oferta_botones")) ??
    (await getNode(sb, empresaId, flowCode, "oferta_botones"));
  if (!ofertaNode) {
    console.error("FALLO: no existe nodo Oferta_botones en el flujo");
    process.exit(2);
  }
  const ofertaOpts = await getOptions(sb, ofertaNode.id);
  const purchaseCandidates = ofertaOpts.filter(
    (o) => !optionPayloadFinalizesSorteoOrder(o.option_payload) && optionHasCantidadPayload(o)
  );
  if (purchaseCandidates.length < 2) {
    console.error(
      "FALLO: hacen falta al menos 2 opciones de compra con cantidad en Oferta_botones. Encontradas:",
      purchaseCandidates.length
    );
    process.exit(2);
  }
  const opt1 = purchaseCandidates[0]!;
  const opt2 = purchaseCandidates[1]!;
  if (opt1.meta_button_id === opt2.meta_button_id) {
    console.error("FALLO: dos opciones con mismo meta_button_id");
    process.exit(2);
  }

  const firstNode = (await getFirstActiveNodeCodeForFlow(sb, empresaId, flowCode)) || "inicio";
  const phone = `5959820${String(Math.floor(100000 + Math.random() * 900000))}`;

  logSection("Setup: contacto + conversación + sesión 1");
  const { data: contact, error: ctErr } = await sb
    .from("chat_contacts")
    .upsert(
      {
        empresa_id: empresaId,
        phone_number: phone,
        phone_normalized: phone,
        name: `E2E2 ${phone}`,
      },
      { onConflict: "empresa_id,phone_number" }
    )
    .select("id")
    .single();
  if (ctErr || !contact) {
    console.error("FALLO contacto", ctErr?.message);
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
    console.error("FALLO conversación", cvErr?.message);
    process.exit(2);
  }
  const conversationId = (conv as { id: string }).id;

  const session1 = await insertActiveFlowSessionRow(sb, empresaId, conversationId, flowCode);
  if (!session1) {
    console.error("FALLO session1");
    process.exit(2);
  }
  await sb
    .from("chat_conversations")
    .update({ active_flow_session_id: session1, updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("empresa_id", empresaId);

  logSection("COMPRA 1");
  const r1 = await runOneCompletePurchase({
    sb,
    empresaId,
    conversationId,
    flowCode,
    purchaseMetaButtonId: opt1.meta_button_id,
    textProfile: "p1",
    label: "compra_1",
  });
  if (r1.flowSessionId !== session1) {
    console.error("FALLO: compra 1 no usó session1", r1.flowSessionId, session1);
    process.exit(3);
  }

  const snap1 = await sb
    .from("sorteo_entradas")
    .select(
      "id, cantidad_boletos, monto_total, numero_orden, nombre_participante, documento, comprobante_url, created_at"
    )
    .eq("id", r1.entradaId)
    .single();
  if (snap1.error || !snap1.data) {
    console.error("FALLO snapshot entrada 1", snap1.error?.message);
    process.exit(3);
  }

  const fd1 = await readFlowDataMap(sb, empresaId, conversationId, flowCode, session1);
  const keysCommercial1 = {
    sorteo_snap_cantidad: fd1.sorteo_snap_cantidad,
    sorteo_snap_monto: fd1.sorteo_snap_monto,
    sorteo_snap_opcion_label: fd1.sorteo_snap_opcion_label,
    resumen_compra: fd1.resumen_compra,
    sorteo_comprobante_url: fd1.sorteo_comprobante_url,
    sorteo_comprobante_media_id: fd1.sorteo_comprobante_media_id,
    cedula: fd1.cedula,
    apellido: fd1.apellido,
  };

  logSection('Reinicio flujo (equivalente "hola" / reiniciar)');
  const rr = await restartWhatsappConversationToFlowStart(sb, empresaId, conversationId, {
    preferFlowCode: flowCode,
    trigger: "e2e_test2_keyword_restart",
  });
  if (!rr.restarted || !rr.flow_current_node) {
    console.error("FALLO restart", JSON.stringify(rr));
    process.exit(4);
  }
  const stateAfter = await getConversationFlowState(sb, conversationId);
  const session2 = stateAfter?.active_flow_session_id?.trim();
  if (!session2 || session2 === session1) {
    console.error("FALLO: session2 igual o vacía tras restart", session1, session2);
    process.exit(4);
  }

  const sRestart = await sendCurrentFlowNode(sb, { conversationId });
  if (!sRestart.ok) {
    console.error("FALLO send tras restart", sRestart.error);
    process.exit(4);
  }

  logSection("COMPRA 2");
  const r2 = await runOneCompletePurchase({
    sb,
    empresaId,
    conversationId,
    flowCode,
    purchaseMetaButtonId: opt2.meta_button_id,
    textProfile: "p2",
    label: "compra_2",
  });
  if (r2.flowSessionId !== session2) {
    console.error("FALLO: compra 2 no usó session2", r2.flowSessionId, session2);
    process.exit(5);
  }

  const fd2 = await readFlowDataMap(sb, empresaId, conversationId, flowCode, session2);

  const snap1b = await sb
    .from("sorteo_entradas")
    .select(
      "id, cantidad_boletos, monto_total, numero_orden, nombre_participante, documento, comprobante_url, created_at"
    )
    .eq("id", r1.entradaId)
    .single();

  const snap2 = await sb
    .from("sorteo_entradas")
    .select(
      "id, cantidad_boletos, monto_total, numero_orden, nombre_participante, documento, comprobante_url, created_at"
    )
    .eq("id", r2.entradaId)
    .single();

  const { data: allEnt, error: allErr } = await sb
    .from("sorteo_entradas")
    .select("id, cantidad_boletos, monto_total, numero_orden, created_at")
    .eq("chat_conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (allErr) {
    console.error("FALLO list entradas", allErr.message);
    process.exit(5);
  }

  const cups1 = await sb
    .from("sorteo_cupones")
    .select("numero_cupon")
    .eq("entrada_id", r1.entradaId)
    .order("numero_cupon", { ascending: true });
  const cups2 = await sb
    .from("sorteo_cupones")
    .select("numero_cupon")
    .eq("entrada_id", r2.entradaId)
    .order("numero_cupon", { ascending: true });

  logSection("VERIFICACIÓN");

  const fail = (msg: string) => {
    console.error("PRUEBA 2: FALLIDA —", msg);
    process.exit(10);
  };

  if ((allEnt ?? []).length < 2) {
    fail(`se esperaban 2 entradas, hay ${(allEnt ?? []).length}`);
  }

  if (r1.entradaId === r2.entradaId) {
    fail("misma entrada_id para ambas compras");
  }

  const a = snap1.data as Record<string, unknown>;
  const b = snap1b.data as Record<string, unknown>;
  for (const k of ["cantidad_boletos", "monto_total", "numero_orden", "comprobante_url", "nombre_participante", "documento"]) {
    if (String(a[k] ?? "") !== String(b[k] ?? "")) {
      fail(`entrada 1 fue modificada: campo ${k} antes/después distinto`);
    }
  }

  if (fd1.sorteo_comprobante_url === fd2.sorteo_comprobante_url && fd1.sorteo_comprobante_url) {
    fail("mismo comprobante_url en chat_flow_data de sesión 1 y 2");
  }

  if (
    fd1.sorteo_snap_opcion_label &&
    fd2.sorteo_snap_opcion_label &&
    fd1.sorteo_snap_opcion_label === fd2.sorteo_snap_opcion_label &&
    opt1.label !== opt2.label
  ) {
    fail(
      `mismo sorteo_snap_opcion_label en ambas sesiones (${fd1.sorteo_snap_opcion_label}) pero opciones distintas`
    );
  }

  if (fd2.cedula !== "4022222") {
    fail(`sesión 2 debería tener cédula 4022222, tiene ${fd2.cedula}`);
  }
  if (fd1.cedula !== "4011111") {
    fail(`sesión 1 debería conservar cédula 4011111, tiene ${fd1.cedula}`);
  }

  if (r1.cuponCount < 1 || r2.cuponCount < 1) {
    fail(`cupones: r1=${r1.cuponCount} r2=${r2.cuponCount}`);
  }

  logSection("RESULTADO TEST 2: EXITOSA");
  console.log("teléfono ficticio:", phone);
  console.log("conversation_id:", conversationId);
  console.log("flow_session_id compra 1:", session1);
  console.log("flow_session_id compra 2:", session2);
  console.log("\n--- chat_flow_data sesión 1 (clave comercial + comprobante) ---");
  console.log(JSON.stringify(keysCommercial1, null, 2));
  console.log("\n--- chat_flow_data sesión 2 (mismas claves) ---");
  console.log(
    JSON.stringify(
      {
        sorteo_snap_cantidad: fd2.sorteo_snap_cantidad,
        sorteo_snap_monto: fd2.sorteo_snap_monto,
        sorteo_snap_opcion_label: fd2.sorteo_snap_opcion_label,
        resumen_compra: fd2.resumen_compra,
        sorteo_comprobante_url: fd2.sorteo_comprobante_url,
        sorteo_comprobante_media_id: fd2.sorteo_comprobante_media_id,
        cedula: fd2.cedula,
        apellido: fd2.apellido,
      },
      null,
      2
    )
  );
  console.log("\n--- sorteo_entradas compra 1 (inalterada tras compra 2) ---");
  console.log(JSON.stringify(snap1b.data, null, 2));
  console.log("\n--- sorteo_entradas compra 2 ---");
  console.log(JSON.stringify(snap2.data, null, 2));
  console.log("\n--- cupones compra 1 ---", JSON.stringify((cups1.data ?? []).map((x) => (x as { numero_cupon: string }).numero_cupon)));
  console.log("--- cupones compra 2 ---", JSON.stringify((cups2.data ?? []).map((x) => (x as { numero_cupon: string }).numero_cupon)));
  console.log("\nOpción compra 1:", opt1.label, opt1.meta_button_id);
  console.log("Opción compra 2:", opt2.label, opt2.meta_button_id);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
