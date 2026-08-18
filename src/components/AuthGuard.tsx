"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import ZentraLoader from "@/components/ZentraLoader";
import { BootProvider, useBoot } from "@/components/BootContext";
import { getCurrentUser, getSession } from "@/lib/auth";
import { getModuleAccessCached } from "@/lib/modulos/module-access-cache";
import { isBootstrapSuperAdminEmail } from "@/lib/auth/super-admin-bootstrap-email";
import {
  firstAccessibleHref,
  isModuleSlugGranted,
  pathRequiresModuleSlug,
} from "@/lib/modulos/route-slug-map";

const PUBLIC_ROUTES = ["/login"];

type ModuleAccess = {
  superAdmin: boolean;
  slugs: Set<string>;
  inactiveSlugs: Set<string>;
  strict: boolean;
};

/**
 * Wrapper exportado: envuelve la app con BootProvider para que el loader
 * se sincronice con el estado del Sidebar (sidebarReady).
 */
export default function AuthGuard({ children }: { children: React.ReactNode }) {
  return (
    <BootProvider>
      <AuthGuardInner>{children}</AuthGuardInner>
    </BootProvider>
  );
}

function AuthGuardInner({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [access, setAccess] = useState<ModuleAccess | null>(null);
  const [blockedSlug, setBlockedSlug] = useState<string | null>(null);
  const { sidebarReady } = useBoot();

  const isPublic = useMemo(
    () => !!(pathname && PUBLIC_ROUTES.includes(pathname)),
    [pathname]
  );

  useEffect(() => {
    if (isPublic) {
      setLoading(false);
      setAccess(null);
      return;
    }

    let cancelled = false;

    async function checkAuthAndModules() {
      setLoading(true);
      const session = await getSession();
      if (cancelled) return;
      if (!session) {
        router.push("/login");
        setLoading(false);
        return;
      }

      const { ok, data } = await getModuleAccessCached();
      if (cancelled) return;

      let superAdmin = false;
      let slugs: string[] = [];
      let inactiveSlugs: string[] = [];
      let strict = false;

      const bootstrapSuper = isBootstrapSuperAdminEmail(session.user.email ?? null);

      if (ok) {
        superAdmin = !!data.superAdmin || bootstrapSuper;
        slugs = Array.isArray(data.slugs) ? data.slugs : [];
        inactiveSlugs = Array.isArray(data.inactiveSlugs) ? data.inactiveSlugs : [];
        strict = !!data.strictAllowlist;
      } else {
        superAdmin = bootstrapSuper;
      }

      if (!superAdmin) {
        try {
          const cu = await getCurrentUser();
          if ((cu?.rol ?? "").trim() === "super_admin") superAdmin = true;
        } catch {
          /* sin fila usuarios en cliente */
        }
      }

      setAccess({
        superAdmin,
        slugs: new Set(slugs),
        inactiveSlugs: new Set(inactiveSlugs),
        strict,
      });
      setLoading(false);
    }

    checkAuthAndModules();
    return () => {
      cancelled = true;
    };
  }, [isPublic, router]);

  useEffect(() => {
    if (loading || isPublic || !access || !pathname) {
      setBlockedSlug(null);
      return;
    }

    if (pathname.startsWith("/admin") && !access.superAdmin) {
      router.replace(
        firstAccessibleHref(access.slugs, {
          superAdmin: false,
          inactiveSlugs: access.inactiveSlugs,
          strict: access.strict,
        })
      );
      setBlockedSlug(null);
      return;
    }

    const slug = pathRequiresModuleSlug(pathname);
    if (
      slug &&
      !access.superAdmin &&
      !isModuleSlugGranted(slug, access.slugs, access.inactiveSlugs, { strict: access.strict })
    ) {
      setBlockedSlug(slug);
      return;
    }
    setBlockedSlug(null);
  }, [pathname, access, loading, isPublic, router]);

  // Overlay de carga: el loader queda encima MIENTRAS children se montan en background.
  // Así el sidebar/dashboard ya están fetcheando sus datos al desaparecer el loader.
  // Esperamos a que termine la auth Y a que el Sidebar reporte que cargó sus módulos.
  const showLoader = !isPublic && (loading || !sidebarReady);

  if (blockedSlug && access) {
    const fallback = firstAccessibleHref(access.slugs, {
      superAdmin: access.superAdmin,
      inactiveSlugs: access.inactiveSlugs,
      strict: access.strict,
    });
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-6 text-center bg-gray-50">
        <div className="max-w-md w-full bg-white border border-gray-200 rounded-lg shadow-sm p-8">
          <div className="text-amber-500 text-4xl mb-3" aria-hidden>⚠</div>
          <h1 className="text-lg font-semibold text-gray-900 mb-2">
            Módulo no habilitado para esta empresa.
          </h1>
          <p className="text-sm text-gray-600 mb-1">
            El módulo <code className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">{blockedSlug}</code> no está activo en tu cuenta.
          </p>
          <p className="text-sm text-gray-600 mb-6">
            Si creés que esto es un error, contactá al administrador del sistema.
          </p>
          <Link
            href={fallback}
            className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition"
          >
            Volver al inicio
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      {children}
      {showLoader ? <ZentraLoader overlay /> : null}
    </>
  );
}
