/**
 * Advertencias de integridad del grafo (solo lectura; no bloquea guardado).
 * La ejecución depende de next_node_code en nodos y opciones, no de sort_order.
 */

export type FlowGraphNodeLite = {
  node_code: string;
  node_type: string;
  next_node_code: string | null;
  options: Array<{ id: string; label: string; next_node_code: string | null }>;
};

export type FlowGraphWarning = {
  severity: "warning";
  code: string;
  message: string;
};

function norm(s: string | null | undefined): string {
  return (s ?? "").trim();
}

/** Referencias salientes (next) hacia node_code. */
export function collectReferencedCodes(nodes: FlowGraphNodeLite[]): Set<string> {
  const refs = new Set<string>();
  for (const n of nodes) {
    const nx = norm(n.next_node_code);
    if (nx) refs.add(nx);
    for (const o of n.options) {
      const on = norm(o.next_node_code);
      if (on) refs.add(on);
    }
  }
  return refs;
}

export function computeFlowGraphWarnings(nodes: FlowGraphNodeLite[]): FlowGraphWarning[] {
  const warnings: FlowGraphWarning[] = [];
  const codes = new Set(nodes.map((n) => n.node_code));

  const incomingCount = new Map<string, number>();
  for (const n of nodes) {
    const nx = norm(n.next_node_code);
    if (nx) incomingCount.set(nx, (incomingCount.get(nx) ?? 0) + 1);
    for (const o of n.options) {
      const on = norm(o.next_node_code);
      if (on) incomingCount.set(on, (incomingCount.get(on) ?? 0) + 1);
    }
  }

  for (const n of nodes) {
    const nx = norm(n.next_node_code);
    if (nx && !codes.has(nx)) {
      warnings.push({
        severity: "warning",
        code: "broken_ref_node_next",
        message: `El paso «${n.node_code}» apunta a «${nx}», que no existe en este flujo.`,
      });
    }
    for (const o of n.options) {
      const on = norm(o.next_node_code);
      if (on && !codes.has(on)) {
        warnings.push({
          severity: "warning",
          code: "broken_ref_option_next",
          message: `La opción «${o.label}» (${n.node_code}) apunta a «${on}», que no existe.`,
        });
      }
    }
  }

  const roots = nodes.filter((n) => (incomingCount.get(n.node_code) ?? 0) === 0);
  if (roots.length > 1) {
    warnings.push({
      severity: "warning",
      code: "multiple_roots",
      message: `Hay ${roots.length} pasos sin entrada (${roots.map((r) => r.node_code).join(", ")}). Puede ser intencional si hay varios puntos de entrada.`,
    });
  }
  if (roots.length === 0 && nodes.length > 0) {
    warnings.push({
      severity: "warning",
      code: "no_root",
      message:
        "Ningún paso está sin entrada por enlaces; suele indicar solo ciclos o flujo mal enlazado.",
    });
  }

  const reachable = new Set<string>();
  const queue = roots.map((r) => r.node_code);
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    const list: string[] = [];
    const nn = norm(n.next_node_code);
    if (nn) list.push(nn);
    for (const o of n.options) {
      const on = norm(o.next_node_code);
      if (on) list.push(on);
    }
    adj.set(n.node_code, list);
  }
  while (queue.length) {
    const c = queue.shift()!;
    if (reachable.has(c)) continue;
    reachable.add(c);
    for (const t of adj.get(c) ?? []) {
      if (!reachable.has(t)) queue.push(t);
    }
  }

  if (roots.length >= 1) {
    for (const n of nodes) {
      if (!reachable.has(n.node_code)) {
        warnings.push({
          severity: "warning",
          code: "unreachable_node",
          message: `El paso «${n.node_code}» parece no alcanzable desde los pasos sin entrada (huérfano de ejecución).`,
        });
      }
    }
  }

  for (const n of nodes) {
    const nt = n.node_type.toLowerCase();
    const nx = norm(n.next_node_code);
    const hasOptionDestinations = n.options.some((o) => norm(o.next_node_code));
    if ((nt === "buttons" || nt === "list") && !hasOptionDestinations && !nx) {
      warnings.push({
        severity: "warning",
        code: "interactive_no_destinations",
        message: `El paso «${n.node_code}» (${nt}) no tiene destino en el paso ni en las opciones.`,
      });
    }
    if (
      nt !== "buttons" &&
      nt !== "list" &&
      nt !== "human" &&
      nt !== "end" &&
      !nx &&
      n.options.length === 0
    ) {
      warnings.push({
        severity: "warning",
        code: "linear_no_next",
        message: `El paso «${n.node_code}» no tiene siguiente paso definido (puede ser final intencional).`,
      });
    }
  }

  for (const n of nodes) {
    for (const o of n.options) {
      if (!norm(o.next_node_code)) {
        warnings.push({
          severity: "warning",
          code: "option_no_next",
          message: `Opción «${o.label}» en «${n.node_code}» no tiene destino configurado.`,
        });
      }
    }
  }

  return warnings;
}
