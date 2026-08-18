import { NextRequest, NextResponse } from "next/server";
import { getAuthWithRol, isAdmin } from "@/lib/middleware/auth";
import { successResponse, errorResponse } from "@/lib/api/response";

/** GET /api/me/rol — devuelve {rol, isAdmin}. Usado por UI para gating. */
export async function GET(request: NextRequest) {
  const auth = await getAuthWithRol(request);
  if (!auth) return NextResponse.json(errorResponse("No autenticado"), { status: 401 });
  return NextResponse.json(successResponse({ rol: auth.rol ?? null, isAdmin: isAdmin(auth) }));
}
