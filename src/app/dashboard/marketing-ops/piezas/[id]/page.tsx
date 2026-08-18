import MarketingOpsPiezaDetalleClient from "../../components/MarketingOpsPiezaDetalleClient";

export default async function MarketingOpsPiezaDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MarketingOpsPiezaDetalleClient piezaId={id} />;
}
