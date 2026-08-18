"use client";

import { useEffect, useState } from "react";
import FlowsListPage from "@/app/dashboard/conversaciones/flujos/page";
import { getMisModulos } from "@/lib/empresas/actions";

function hasOmnichannel(slugs: string[]) {
  return slugs.includes("conversaciones") || slugs.includes("omnicanal");
}

export default function ConfiguracionFlowsPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    getMisModulos()
      .then((mods) => setAllowed(hasOmnichannel(mods.map((m) => m.slug))))
      .catch(() => setAllowed(false));
  }, []);

  if (allowed === null) return <div className="text-sm text-slate-500">Cargando...</div>;
  if (!allowed) {
    return (
      <div className="max-w-3xl rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        Tu empresa no tiene habilitado el módulo de Conversaciones/Omnicanal.
      </div>
    );
  }
  return <FlowsListPage />;
}
