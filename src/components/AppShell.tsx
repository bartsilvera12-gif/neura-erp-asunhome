"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./layout/Sidebar";
import Header from "./layout/Header";
import MobileBottomNav from "./layout/MobileBottomNav";

const STANDALONE_ROUTES = ["/login"];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isStandalone = pathname && STANDALONE_ROUTES.includes(pathname);

  if (isStandalone) {
    return <>{children}</>;
  }

  return (
    <div id="neura-app-shell" className="flex h-svh min-h-0 overflow-hidden bg-[#F8FAFC]">
      <Sidebar />
      <div id="neura-main-column" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Header />
        {/* pb-20 en mobile reserva ~80px para que el contenido scrolleable no quede
            tapado por MobileBottomNav (fixed bottom). md:pb-6 vuelve al padding normal
            en desktop donde no hay barra inferior. */}
        <main
          id="neura-main-content"
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain p-4 pb-20 sm:p-6 sm:pb-24 lg:pb-6"
        >
          {children}
        </main>
        {/* Bottom Navigation mobile-only (md:hidden internamente).
            Posición fixed bottom, no afecta layout de desktop. */}
        <MobileBottomNav />
      </div>
    </div>
  );
}
