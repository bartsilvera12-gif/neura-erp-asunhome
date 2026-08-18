"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getMisModulos } from "@/lib/empresas/actions";

export default function SorteosModuleGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [estado, setEstado] = useState<"cargando" | "ok" | "no">("cargando");

  useEffect(() => {
    let cancel = false;
    async function run() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user?.email) {
          if (!cancel) router.replace("/");
          return;
        }
        const { data: urows, error: errUsuario } = await supabase
          .from("usuarios")
          .select("rol")
          .eq("email", session.user.email)
          .limit(1);
        if (errUsuario) {
          if (!cancel) router.replace("/");
          return;
        }
        const usuario = urows?.[0] as { rol?: string } | undefined;

        if (usuario?.rol === "super_admin") {
          if (!cancel) setEstado("ok");
          return;
        }

        const modulos = await getMisModulos();
        if (cancel) return;
        const tiene = modulos.some((m) => m.slug === "sorteos");
        setEstado(tiene ? "ok" : "no");
        if (!tiene) router.replace("/");
      } catch {
        if (!cancel) {
          setEstado("no");
          router.replace("/");
        }
      }
    }
    run();
    return () => {
      cancel = true;
    };
  }, [router]);

  if (estado !== "ok") {
    return (
      <div className="py-16 text-center text-slate-400 text-sm animate-pulse">
        {estado === "cargando" ? "Cargando módulo Sorteos…" : "Redirigiendo…"}
      </div>
    );
  }

  return <>{children}</>;
}
