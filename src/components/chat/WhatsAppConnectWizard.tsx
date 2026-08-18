"use client";

import { useState } from "react";
import { WhatsAppChannelForm } from "@/components/chat/WhatsAppChannelForm";

type Conn = "pick" | "official" | "ycloud";

export function WhatsAppConnectWizard({
  cancelHref,
  onSavedOfficial,
  onSavedYcloud,
}: {
  cancelHref: string;
  onSavedOfficial: (id: string) => void;
  onSavedYcloud: (id: string) => void;
}) {
  const [conn, setConn] = useState<Conn>("pick");

  if (conn === "official") {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Tipo de conexión</p>
            <p className="text-sm font-semibold text-slate-900">WhatsApp Cloud API oficial (Meta)</p>
          </div>
          <button
            type="button"
            className="text-sm font-semibold text-[#0EA5E9] hover:underline"
            onClick={() => setConn("pick")}
          >
            Cambiar
          </button>
        </div>
        <WhatsAppChannelForm
          mode="create"
          cancelHref={cancelHref}
          submitLabelCreate="Conectar y guardar"
          onSaved={onSavedOfficial}
        />
      </div>
    );
  }

  if (conn === "ycloud") {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-bold text-violet-700 uppercase tracking-wide">Tipo de conexión</p>
            <p className="text-sm font-semibold text-violet-950">Coexistencia con YCloud</p>
          </div>
          <button
            type="button"
            className="text-sm font-semibold text-violet-800 hover:underline"
            onClick={() => setConn("pick")}
          >
            Cambiar
          </button>
        </div>
        <WhatsAppChannelForm
          mode="create"
          connectionProfile="ycloud"
          cancelHref={cancelHref}
          submitLabelCreate="Conectar y guardar"
          onSaved={onSavedYcloud}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Elegí cómo conectará WhatsApp tu empresa. Esto define el formulario y la persistencia en base de datos.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setConn("official")}
          className="text-left rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-sm hover:border-[#0EA5E9] hover:shadow-md transition-all"
        >
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Opción A</p>
          <p className="mt-1 text-lg font-bold text-slate-900">WhatsApp Cloud API oficial</p>
          <p className="mt-2 text-sm text-slate-600">
            Meta Graph API, Phone number ID, token de acceso y ruta omnicanal estándar del ERP.
          </p>
        </button>
        <button
          type="button"
          onClick={() => setConn("ycloud")}
          className="text-left rounded-2xl border-2 border-violet-200 bg-violet-50/40 p-5 shadow-sm hover:border-violet-400 hover:shadow-md transition-all"
        >
          <p className="text-xs font-bold text-violet-700 uppercase tracking-wide">Opción B</p>
          <p className="mt-1 text-lg font-bold text-violet-950">Coexistencia con YCloud</p>
          <p className="mt-2 text-sm text-violet-900/80">
            Proveedor YCloud, API key y datos de canal. La capa de webhook real se completa en Etapa 2.
          </p>
        </button>
      </div>
    </div>
  );
}
