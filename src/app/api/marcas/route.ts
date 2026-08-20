import { makeMaestroHandlers } from "@/lib/inventario/server/maestros-route-factory";

const h = makeMaestroHandlers("marcas", "marcas");

export const GET = h.GET;
export const POST = h.POST;
export const PATCH = h.PATCH;
export const DELETE = h.DELETE;
