"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Users,
  FileText,
  Settings,
  UserCog,
  Building2,
  ChevronDown,
  ChevronRight,
  Star,
  Sparkles,
  PanelLeftClose,
  PanelLeft,
  Search,
  Receipt,
  Megaphone,
  Ticket,
  SendHorizontal,
  MessageCircle,
  History,
  Activity,
  ScrollText,
  ListChecks,
  FolderKanban,
  Percent,
  ChefHat,
  Utensils,
} from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { getCurrentUser } from "@/lib/auth";
import { isBootstrapSuperAdminEmail } from "@/lib/auth/super-admin-bootstrap-email";
import { supabase } from "@/lib/supabase";
import type { ModuloEmpresa } from "@/lib/empresas/actions";
import { getFavoritos, toggleFavorito } from "@/lib/favorites";
import { canAccessSidebarSlug } from "@/lib/modulos/route-slug-map";
import { useBoot } from "@/components/BootContext";
import { getModuleAccessCached } from "@/lib/modulos/module-access-cache";

type MenuItem = {
  key: string;
  slug: string;
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  children?: { label: string; href: string; exactMatch?: boolean }[];
  showWhen?: string;
};

function menuChildPathActive(path: string, childHref: string, exactMatch?: boolean): boolean {
  if (path === childHref) return true;
  if (exactMatch) return false;
  return path.startsWith(`${childHref}/`);
}

/** Normaliza texto para búsqueda en el menú (sin acentos, minúsculas). */
function normalizeMenuSearch(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function menuItemMatchesQuery(item: MenuItem, queryRaw: string): boolean {
  const q = normalizeMenuSearch(queryRaw);
  if (!q) return true;
  if (normalizeMenuSearch(item.label).includes(q)) return true;
  return item.children?.some((c) => normalizeMenuSearch(c.label).includes(q)) ?? false;
}

function adminEmpresasMatchesQuery(queryRaw: string): boolean {
  const q = normalizeMenuSearch(queryRaw);
  if (!q) return true;
  const label = normalizeMenuSearch("Admin Empresas");
  return label.includes(q) || normalizeMenuSearch("empresas").includes(q);
}

const MENU_STRUCTURE: MenuItem[] = [
  { key: "dashboard", slug: "dashboard", label: "Dashboard", href: "/", icon: LayoutDashboard },
  {
    key: "conversaciones",
    slug: "conversaciones",
    label: "Conversaciones",
    href: "/dashboard/conversaciones",
    icon: MessageCircle,
  },
  {
    key: "historial-omnicanal",
    slug: "historial-omnicanal",
    label: "Historial omnicanal",
    href: "/dashboard/historial-omnicanal",
    icon: History,
  },
  {
    key: "conversaciones-finalizadas",
    slug: "conversaciones-finalizadas",
    label: "Finalizadas",
    href: "/dashboard/conversaciones-finalizadas",
    icon: ListChecks,
  },
  {
    key: "monitoreo",
    slug: "monitoreo",
    label: "Monitoreo",
    href: "/dashboard/monitoreo",
    icon: Activity,
  },
  { key: "ventas", slug: "ventas", label: "Ventas", href: "/ventas", icon: ShoppingCart },
  {
    key: "proyectos",
    slug: "proyectos",
    label: "Pedidos",
    href: "/dashboard/proyectos",
    icon: Utensils,
  },
  { key: "recetas", slug: "recetas", label: "Recetas", href: "/dashboard/recetas", icon: ChefHat },
  { key: "inventario", slug: "inventario", label: "Inventario", href: "/inventario", icon: Package, children: [
    { label: "Productos", href: "/inventario" },
    { label: "Movimientos", href: "/inventario/movimientos" },
    { label: "Categorías", href: "/inventario/categorias" },
    // "Depósitos / Ubicaciones" oculto en instancia En lo de Mari (no aplica para gastronomía).
  ]},
  { key: "clientes", slug: "clientes", label: "Clientes", href: "/clientes", icon: Users },
  {
    key: "compras",
    slug: "compras",
    label: "Compras",
    href: "/compras",
    icon: Package,
    children: [
      { label: "Órdenes", href: "/compras" },
      { label: "Proveedores", href: "/proveedores" },
    ],
  },
  { key: "gastos", slug: "gastos", label: "Gastos", href: "/gastos", icon: Receipt },
  // Pagos oculto en instancia En lo de Mari (no usa este módulo).
  { key: "comisiones", slug: "comisiones", label: "Comisiones", href: "/comisiones", icon: Percent },
  {
    key: "notas_credito",
    slug: "notas_credito",
    label: "Notas de crédito",
    href: "/notas-credito",
    icon: ScrollText,
  },
  { key: "usuarios", slug: "usuarios", label: "Usuarios", href: "/usuarios", icon: UserCog },
  {
    key: "configuracion",
    slug: "configuracion",
    label: "Configuración",
    href: "/configuracion",
    icon: Settings,
    children: [
      { label: "Facturación", href: "/configuracion/facturacion" },
      { label: "Equipos y supervisión", href: "/configuracion/omnicanal-equipos" },
    ],
  },
  { key: "planes", slug: "planes", label: "Planes", href: "/planes", icon: FileText },
  { key: "gestion-clientes", slug: "gestion-clientes", label: "Gestión Clientes", href: "/gestion-clientes", icon: Users },
  { key: "crm", slug: "crm", label: "CRM Funnel", href: "/crm", icon: Sparkles },
  { key: "marketing", slug: "marketing", label: "Marketing Legacy", href: "/marketing", icon: Megaphone },
  { key: "marketing_ops", slug: "marketing_ops", label: "Marketing Ops", href: "/dashboard/marketing-ops", icon: Megaphone },
  {
    key: "campanas",
    slug: "campanas",
    label: "Campañas",
    href: "/dashboard/campanas",
    icon: SendHorizontal,
  },
  {
    key: "sorteos",
    slug: "sorteos",
    label: "Sorteos",
    href: "/sorteos",
    icon: Ticket,
    children: [{ label: "Tickets / Comprobantes", href: "/sorteos/tickets", exactMatch: true }],
  },
];

function modulosSyntheticFromMenu(): ModuloEmpresa[] {
  return MENU_STRUCTURE.map((item) => ({
    id: item.slug,
    nombre: item.label,
    slug: item.slug,
  }));
}

function NavItem({
  item,
  itemId,
  isActive,
  isFavorito,
  onToggleFavorito,
  hasAccess,
  collapsed,
  expanded,
  onToggleExpand,
}: {
  item: MenuItem;
  itemId: string;
  isActive: boolean;
  isFavorito: boolean;
  onToggleFavorito: (id: string) => void;
  hasAccess: boolean;
  collapsed: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const Icon = item.icon;
  const p = usePathname() ?? "";
  const router = useRouter();

  if (!hasAccess) return null;

  const childActive = item.children?.some((c) => menuChildPathActive(p, c.href, c.exactMatch));

  if (item.children) {
    const rowTone =
      isActive || childActive
        ? "bg-[color:var(--zentra-sidebar-active)] text-white shadow-[inset_3px_0_0_var(--zentra-sidebar-accent)]"
        : "text-slate-200 hover:bg-[color:var(--zentra-sidebar-hover)]";
    return (
      <div className="space-y-0.5">
        <div className={`flex items-center gap-0.5 rounded-lg text-sm font-medium transition-colors ${rowTone}`}>
          <Link
            href={item.href}
            prefetch={false}
            onMouseEnter={() => router.prefetch(item.href)}
            className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5"
            title={item.label}
          >
            <Icon className={`h-5 w-5 shrink-0 ${isActive || childActive ? "text-white" : "text-slate-400"}`} />
            {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
          </Link>
          {!collapsed && (
            <>
              <button
                type="button"
                onClick={() => onToggleFavorito(itemId)}
                className={`shrink-0 rounded p-0.5 ${isFavorito ? "text-amber-300" : "text-slate-500 hover:text-amber-300"}`}
                aria-label="Favorito"
              >
                <Star className={`h-4 w-4 ${isFavorito ? "fill-current" : ""}`} />
              </button>
              <button
                type="button"
                onClick={() => onToggleExpand()}
                className="shrink-0 rounded p-1 text-current hover:opacity-90"
                aria-expanded={expanded}
                aria-label={expanded ? "Contraer submenú" : "Expandir submenú"}
              >
                {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
            </>
          )}
        </div>
        <AnimatePresence>
          {expanded && !collapsed && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden pl-4 space-y-0.5"
            >
              {item.children.map((c) => (
                <Link
                  key={c.href}
                  href={c.href}
                  prefetch={false}
                  onMouseEnter={() => router.prefetch(c.href)}
                  className={`block rounded-lg px-3 py-2 text-sm transition-all ${
                    menuChildPathActive(p, c.href, c.exactMatch)
                      ? "bg-[color:var(--zentra-sidebar-active)] text-white font-medium shadow-[inset_3px_0_0_var(--zentra-sidebar-accent)]"
                      : "text-slate-300 hover:bg-[color:var(--zentra-sidebar-hover)]"
                  }`}
                >
                  {c.label}
                </Link>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <Link
      href={item.href}
      prefetch={false}
      onMouseEnter={() => router.prefetch(item.href)}
      className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
        isActive
          ? "bg-[color:var(--zentra-sidebar-active)] text-white shadow-[inset_3px_0_0_var(--zentra-sidebar-accent)]"
          : "text-slate-200 hover:bg-[color:var(--zentra-sidebar-hover)]"
      }`}
    >
      <Icon className={`h-5 w-5 shrink-0 ${isActive ? "text-white" : "text-slate-400"}`} />
      {!collapsed && (
        <>
          <span className="flex-1 truncate">{item.label}</span>
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); onToggleFavorito(itemId); }}
            className={`rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 ${
              isFavorito ? "opacity-100 text-amber-300" : "text-slate-500 hover:text-amber-300"
            }`}
          >
            <Star className={`h-4 w-4 ${isFavorito ? "fill-current" : ""}`} />
          </button>
        </>
      )}
    </Link>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const [modulos, setModulos] = useState<ModuloEmpresa[]>([]);
  const [inactiveSlugsList, setInactiveSlugsList] = useState<string[]>([]);
  const [strictAllowlist, setStrictAllowlist] = useState(false);
  const [favoritos, setFavoritos] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({
    inventario: true,
    sorteos: true,
    compras: true,
  });
  const [cargando, setCargando] = useState(true);
  const [esSuperAdmin, setEsSuperAdmin] = useState(false);
  /** Filtro visual del menú (no altera permisos ni rutas). */
  const [menuSearchQuery, setMenuSearchQuery] = useState("");
  const { setSidebarReady, mobileSidebarOpen, setMobileSidebarOpen } = useBoot();

  /** Cerrar el drawer mobile al cambiar de ruta. */
  useEffect(() => {
    if (mobileSidebarOpen) setMobileSidebarOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  /** Reporta al BootContext cuándo el sidebar tiene sus módulos cargados.
   *  Sticky: solo va false → true, nunca true → false. Esto evita que el
   *  ZentraLoader vuelva a aparecer entre navegaciones cuando Supabase
   *  dispara onAuthStateChange (token refresh) y reinicia "cargando". */
  useEffect(() => {
    if (!cargando) {
      setSidebarReady(true);
    }
  }, [cargando, setSidebarReady]);

  useEffect(() => {
    setFavoritos(getFavoritos());
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function cargarMenuDesdeSesion(session: Session | null) {
      try {
        setCargando(true);
        if (cancelled) return;
        if (!session?.user) {
          setModulos([]);
          setEsSuperAdmin(false);
          return;
        }

        const { ok, data: body } = await getModuleAccessCached();
        if (cancelled) return;

        let superA = false;
        let modList: ModuloEmpresa[] = [];
        const bootstrapSuper = isBootstrapSuperAdminEmail(session.user.email ?? null);

        let inactiveList: string[] = [];
        let strict = false;
        if (ok) {
          superA = !!body.superAdmin || bootstrapSuper;
          modList = Array.isArray(body.modulos) ? body.modulos : [];
          inactiveList = Array.isArray(body.inactiveSlugs) ? body.inactiveSlugs : [];
          strict = !!body.strictAllowlist;
        } else {
          superA = bootstrapSuper;
        }

        if (!superA) {
          try {
            const cu = await getCurrentUser();
            if ((cu?.rol ?? "").trim() === "super_admin") {
              superA = true;
              const mr = await fetchWithSupabaseSession("/api/admin/modulos", { cache: "no-store" });
              if (mr.ok) {
                const raw = (await mr.json()) as { id?: string; nombre?: string; slug?: string }[];
                if (Array.isArray(raw) && raw.length > 0) {
                  modList = raw.map((m) => ({
                    id: m.id ?? "",
                    nombre: m.nombre ?? "",
                    slug: m.slug ?? "",
                  }));
                }
              }
            }
          } catch {
            /* getCurrentUser puede fallar si RLS; el servidor ya intentó */
          }
        }

        if (superA && modList.length === 0) {
          modList = modulosSyntheticFromMenu();
        }

        if (cancelled) return;
        setEsSuperAdmin(superA);
        setModulos(modList);
        setInactiveSlugsList(inactiveList);
        setStrictAllowlist(strict);
      } catch {
        if (!cancelled) {
          setModulos([]);
          setEsSuperAdmin(false);
          setInactiveSlugsList([]);
          setStrictAllowlist(false);
        }
      } finally {
        if (!cancelled) setCargando(false);
      }
    }

    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (!cancelled) void cargarMenuDesdeSesion(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      void cargarMenuDesdeSesion(session);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const handleToggleFavorito = (id: string) => {
    setFavoritos(toggleFavorito(id));
  };

  const modulosSlugs = new Set(modulos.map((m) => m.slug));
  const inactiveSlugsSet = useMemo(() => new Set(inactiveSlugsList), [inactiveSlugsList]);
  const hasAccess = (slug: string) =>
    canAccessSidebarSlug(slug, modulosSlugs, esSuperAdmin, inactiveSlugsSet, {
      strict: strictAllowlist,
    });

  const isActive = (slug: string, href: string) => {
    const p = pathname ?? "";
    if (slug === "dashboard") return p === "/";
    return p === href || p.startsWith(href + "/");
  };

  const toggleExpand = (menuKey: string) => {
    setExpandedItems((prev) => ({ ...prev, [menuKey]: !prev[menuKey] }));
  };

  const slugToId = (slug: string) => modulos.find((m) => m.slug === slug)?.id ?? slug;

  const favoritosItemsFiltered = useMemo(() => {
    const slugs = new Set(modulos.map((m) => m.slug));
    const idForSlug = (slug: string) => modulos.find((m) => m.slug === slug)?.id ?? slug;
    const access = (slug: string) =>
      canAccessSidebarSlug(slug, slugs, esSuperAdmin, inactiveSlugsSet, { strict: strictAllowlist });
    return MENU_STRUCTURE.filter(
      (item) =>
        favoritos.includes(idForSlug(item.slug)) &&
        access(item.slug) &&
        menuItemMatchesQuery(item, menuSearchQuery)
    );
  }, [favoritos, menuSearchQuery, modulos, esSuperAdmin, inactiveSlugsSet, strictAllowlist]);

  const mainItemsFiltered = useMemo(() => {
    const slugs = new Set(modulos.map((m) => m.slug));
    const idForSlug = (slug: string) => modulos.find((m) => m.slug === slug)?.id ?? slug;
    const access = (slug: string) =>
      canAccessSidebarSlug(slug, slugs, esSuperAdmin, inactiveSlugsSet, { strict: strictAllowlist });
    return MENU_STRUCTURE.filter(
      (item) =>
        !favoritos.includes(idForSlug(item.slug)) &&
        access(item.slug) &&
        menuItemMatchesQuery(item, menuSearchQuery)
    );
  }, [favoritos, menuSearchQuery, modulos, esSuperAdmin, inactiveSlugsSet, strictAllowlist]);

  const anyMenuVisible =
    favoritosItemsFiltered.length > 0 ||
    mainItemsFiltered.length > 0 ||
    (esSuperAdmin && adminEmpresasMatchesQuery(menuSearchQuery));

  const showMenuNoResults =
    !cargando && normalizeMenuSearch(menuSearchQuery).length > 0 && !anyMenuVisible;

  useEffect(() => {
    const q = menuSearchQuery.trim();
    if (!q) return;
    const n = normalizeMenuSearch(q);
    setExpandedItems((prev) => {
      const next = { ...prev };
      for (const item of MENU_STRUCTURE) {
        if (item.children?.some((c) => normalizeMenuSearch(c.label).includes(n))) {
          next[item.key] = true;
        }
      }
      return next;
    });
  }, [menuSearchQuery]);

  return (
    <>
      {/* Backdrop mobile: cubre el contenido cuando el drawer esta abierto */}
      {mobileSidebarOpen ? (
        <button
          type="button"
          aria-label="Cerrar menú"
          onClick={() => setMobileSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-slate-900/55 backdrop-blur-sm md:hidden"
        />
      ) : null}

      <motion.aside
        id="neura-sidebar"
        initial={false}
        animate={{ width: collapsed ? 80 : 260 }}
        transition={{ duration: 0.2 }}
        className={`zentra-sidebar-bg flex h-svh min-h-0 shrink-0 flex-col border-r border-[color:var(--zentra-sidebar-border)] md:relative md:translate-x-0 ${
          mobileSidebarOpen
            ? "fixed inset-y-0 left-0 z-50 translate-x-0 shadow-2xl transition-transform duration-200"
            : "fixed inset-y-0 left-0 z-50 -translate-x-full md:translate-x-0 transition-transform duration-200"
        }`}
      >
      {/* Logo oficial ZENTRA (blanco sobre azul marca) */}
      <div className="flex h-[7.25rem] shrink-0 items-center justify-between gap-2 border-b border-[color:var(--zentra-sidebar-border)] bg-[color:var(--zentra-sidebar-elevated)]/35 px-3 py-2.5">
        <Link href="/" className={`flex items-center justify-center min-w-0 flex-1 overflow-hidden`}>
          <div
            className={`relative flex items-center justify-center ${collapsed ? "h-11 w-11" : "h-[4.5rem] w-full max-w-[200px]"}`}
          >
            <Image
              src="/brand/zentra-logo-official.png"
              alt="ZENTRA"
              width={400}
              height={220}
              sizes={collapsed ? "44px" : "200px"}
              className="h-full w-full object-contain object-center"
              priority
            />
          </div>
        </Link>
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-[color:var(--zentra-sidebar-hover)] hover:text-white"
          aria-label={collapsed ? "Expandir sidebar" : "Colapsar sidebar"}
        >
          {collapsed ? <PanelLeft className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
        </button>
      </div>

      {!collapsed && (
        <div className="shrink-0 border-b border-[color:var(--zentra-sidebar-border)] px-3 py-2.5">
          <label htmlFor="sidebar-menu-search" className="sr-only">
            Buscar en el menú
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <input
              id="sidebar-menu-search"
              type="search"
              autoComplete="off"
              placeholder="Buscar en el menú…"
              value={menuSearchQuery}
              onChange={(e) => setMenuSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-white/15 bg-white/10 py-2 pl-8 pr-2.5 text-xs text-white outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 focus:border-sky-400/45 focus:ring-2 focus:ring-sky-400/35"
            />
          </div>
        </div>
      )}

      <nav className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain p-3">
        {showMenuNoResults ? (
          <p className="px-2 py-6 text-center text-xs text-slate-400">Sin resultados</p>
        ) : null}

        {/* Favoritos */}
        {favoritosItemsFiltered.length > 0 && !collapsed && (
          <div className="mb-4">
            <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-slate-500">★ Favoritos</p>
            <div className="space-y-0.5">
              {favoritosItemsFiltered.map((item) => (
                <NavItem
                  key={item.key}
                  item={item}
                  itemId={slugToId(item.slug)}
                  isActive={isActive(item.slug, item.href)}
                  isFavorito={true}
                  onToggleFavorito={handleToggleFavorito}
                  hasAccess={hasAccess(item.slug)}
                  collapsed={collapsed}
                  expanded={expandedItems[item.key] ?? false}
                  onToggleExpand={() => toggleExpand(item.key)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Menú principal */}
        <div className="space-y-0.5">
          {!collapsed && mainItemsFiltered.length > 0 && (
            <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-slate-500">General</p>
          )}
          {cargando ? (
            <div className="px-3 py-2 text-sm text-slate-500 animate-pulse">Cargando…</div>
          ) : (
            mainItemsFiltered.map((item) => (
              <NavItem
                key={item.key}
                item={item}
                itemId={slugToId(item.slug)}
                isActive={isActive(item.slug, item.href)}
                isFavorito={favoritos.includes(slugToId(item.slug))}
                onToggleFavorito={handleToggleFavorito}
                hasAccess={hasAccess(item.slug)}
                collapsed={collapsed}
                expanded={expandedItems[item.key] ?? false}
                onToggleExpand={() => toggleExpand(item.key)}
              />
            ))
          )}
        </div>

        {/* Admin */}
        {esSuperAdmin && adminEmpresasMatchesQuery(menuSearchQuery) && (
          <div className="mt-6 pt-4 border-t border-[color:var(--zentra-sidebar-border)]">
            {!collapsed && (
              <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Admin</p>
            )}
            <Link
              href="/admin/empresas"
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
                (pathname ?? "").startsWith("/admin/empresas")
                  ? "bg-[color:var(--zentra-sidebar-active)] text-amber-100 shadow-[inset_3px_0_0_var(--zentra-sidebar-accent)]"
                  : "text-amber-300/95 hover:bg-[color:var(--zentra-sidebar-hover)]"
              }`}
            >
              <Building2 className="h-5 w-5 shrink-0" />
              {!collapsed && <span className="truncate">Admin Empresas</span>}
            </Link>
          </div>
        )}
      </nav>
      </motion.aside>
    </>
  );
}
