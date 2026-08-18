import ProyectoDetalleClient from "./ProyectoDetalleClient";

export default function ProyectoDetallePage({ params }: { params: Promise<{ id: string }> }) {
  return <ProyectoDetalleClient params={params} />;
}
