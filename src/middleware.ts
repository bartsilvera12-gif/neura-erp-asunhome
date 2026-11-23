import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { BLOQUEO_PAGO_MENSAJE, BLOQUEO_PAGO_PATH, erpBloqueadoPorFaltaDePago } from "@/lib/bloqueo-pago";

export async function middleware(request: NextRequest) {
  // Assets estaticos: no hace falta refresh de sesion Supabase.
  if (/\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?|ttf)$/i.test(request.nextUrl.pathname)) {
    return NextResponse.next({ request });
  }

  // ===== Acceso suspendido por falta de pago (sistema de Neura, por dominio) =====
  if (await erpBloqueadoPorFaltaDePago(request.headers)) {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: BLOQUEO_PAGO_MENSAJE }, { status: 402 });
    }
    if (request.nextUrl.pathname !== BLOQUEO_PAGO_PATH) {
      const bloqueoUrl = request.nextUrl.clone();
      bloqueoUrl.pathname = BLOQUEO_PAGO_PATH;
      bloqueoUrl.search = "";
      return NextResponse.redirect(bloqueoUrl, 307);
    }
    return NextResponse.next({ request });
  }
  // Rehabilitado: quien quedó en /bloqueado vuelve al inicio.
  if (request.nextUrl.pathname === BLOQUEO_PAGO_PATH) {
    const inicio = request.nextUrl.clone();
    inicio.pathname = "/";
    inicio.search = "";
    return NextResponse.redirect(inicio, 307);
  }

  let supabaseResponse = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return supabaseResponse;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  await supabase.auth.getUser();

  return supabaseResponse;
}

/**
 * Excluir `/api/webhooks/*`: Meta hace GET sin cookies para verificar el webhook;
 * no debe pasar por refresh de sesion Supabase.
 */
export const config = {
  matcher: ["/((?!api/webhooks|_next/static|_next/image).*)"],
};
