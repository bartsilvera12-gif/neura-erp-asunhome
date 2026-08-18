import { redirect } from "next/navigation";

export default async function DashboardEditarRevendedorPage({
  params,
}: {
  params: Promise<{ id: string; revId: string }>;
}) {
  const { id, revId } = await params;
  redirect(`/sorteos/${id}/revendedores/${revId}/editar`);
}
