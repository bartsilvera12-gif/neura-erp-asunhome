"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { getSession, getCurrentUser } from "@/lib/auth";
import { isBootstrapSuperAdminEmail } from "@/lib/auth/super-admin-bootstrap-email";

/**
 * No usar solo getCurrentUser() aquí: el cliente anon + RLS en `zentra_erp.usuarios`
 * puede fallar o devolver null para super_admin y redirigía erróneamente a /login.
 * La API module-access resuelve rol con service role (misma lógica que AuthGuard).
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ok, setOk] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const session = await getSession();
        if (cancelled) return;
        if (!session?.user) {
          router.replace("/login");
          return;
        }

        if (isBootstrapSuperAdminEmail(session.user.email ?? null)) {
          setOk(true);
          return;
        }

        const res = await fetchWithSupabaseSession("/api/empresas/module-access", {
          cache: "no-store",
        });
        if (cancelled) return;

        if (res.status === 401) {
          router.replace("/login");
          return;
        }

        let isSuper = false;
        if (res.ok) {
          const data = (await res.json()) as { superAdmin?: boolean };
          isSuper = !!data.superAdmin;
        }

        if (!isSuper) {
          try {
            const u = await getCurrentUser();
            if ((u?.rol ?? "").trim() === "super_admin") isSuper = true;
          } catch {
            /* RLS u error de red */
          }
        }

        if (!isSuper) {
          router.replace("/");
          return;
        }
        setOk(true);
      } catch {
        if (!cancelled) router.replace("/login");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[200px] text-sm text-gray-500">
        Verificando acceso…
      </div>
    );
  }
  if (!ok) return null;
  return <>{children}</>;
}
