import { NextResponse } from "next/server";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireMarketingOpsApiAccess } from "@/lib/marketing-ops/auth";
import { getMarketingOpsDashboard } from "@/lib/marketing-ops/service";

export async function GET(request: Request) {
  const auth = await requireMarketingOpsApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  try {
    const data = await getMarketingOpsDashboard(auth.empresaId);
    return NextResponse.json(successResponse(data));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
