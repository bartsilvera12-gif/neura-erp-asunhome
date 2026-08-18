"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { channelTypeLabel } from "@/components/chat/ChannelBadge";
import { GenericOmnichannelChannelForm } from "@/components/chat/GenericOmnichannelChannelForm";
import { WhatsAppConnectWizard } from "@/components/chat/WhatsAppConnectWizard";
import { OMNICHANNEL_CARD_DEFINITIONS, isOmnichannelCardType } from "@/lib/chat/omnichannel-catalog";

function hasOmnichannelFromModuleAccess(body: {
  superAdmin?: boolean;
  slugs?: string[];
}): boolean {
  if (body.superAdmin) return true;
  const slugs = Array.isArray(body.slugs) ? body.slugs : [];
  return slugs.includes("conversaciones") || slugs.includes("omnicanal");
}

export function NuevoCanalInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tipoRaw = (searchParams?.get("tipo") ?? "whatsapp").trim().toLowerCase();
  const tipo = isOmnichannelCardType(tipoRaw) ? tipoRaw : "whatsapp";

  const def = useMemo(
    () => OMNICHANNEL_CARD_DEFINITIONS.find((d) => d.type === tipo) ?? OMNICHANNEL_CARD_DEFINITIONS[0]!,
    [tipo]
  );

  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    fetchWithSupabaseSession("/api/empresas/module-access", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          setAllowed(false);
          return;
        }
        const body = (await res.json()) as { superAdmin?: boolean; slugs?: string[] };
        setAllowed(hasOmnichannelFromModuleAccess(body));
      })
      .catch(() => setAllowed(false));
  }, []);

  if (allowed === null) {
    return <div className="py-24 text-center text-sm text-slate-400">Cargando…</div>;
  }

  if (!allowed) {
    return (
      <div className="max-w-xl rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        Módulo no habilitado.{" "}
        <Link href="/configuracion/canales" className="font-semibold underline">
          Volver
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-none space-y-6 px-4 sm:px-6 lg:px-8 xl:px-10 pb-10">
      <nav className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/configuracion" className="hover:text-slate-800">
          Configuración
        </Link>
        <span>/</span>
        <Link href="/configuracion/canales" className="hover:text-slate-800">
          Canales
        </Link>
        <span>/</span>
        <span className="text-slate-800 font-medium">Nuevo · {channelTypeLabel(tipo)}</span>
      </nav>

      <div>
        <h1 className="text-2xl font-bold text-slate-900">Conectar {def.label}</h1>
        <p className="text-sm text-slate-500 mt-1 max-w-2xl">
          {tipo === "whatsapp"
            ? "Definí primero el tipo de conexión. El flujo Meta oficial conserva el comportamiento actual del webhook."
            : "Configuración base del canal. La mensajería end-to-end se activará cuando corresponda la integración."}
        </p>
      </div>

      <section className="w-full rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6 lg:p-8">
        {tipo === "whatsapp" ? (
          <WhatsAppConnectWizard
            cancelHref="/configuracion/canales"
            onSavedOfficial={(id) => router.push(`/configuracion/canales/${id}`)}
            onSavedYcloud={(id) => router.push(`/configuracion/canales/${id}`)}
          />
        ) : (
          <GenericOmnichannelChannelForm
            mode="create"
            channelType={tipo}
            defaultProvider={def.defaultProvider}
            cancelHref="/configuracion/canales"
            onSaved={(id) => router.push(`/configuracion/canales/${id}`)}
          />
        )}
      </section>
    </div>
  );
}
