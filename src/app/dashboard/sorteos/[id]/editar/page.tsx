import { redirect } from "next/navigation";

export default async function DashboardEditarSorteoAliasPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/sorteos/${id}/editar`);
}
