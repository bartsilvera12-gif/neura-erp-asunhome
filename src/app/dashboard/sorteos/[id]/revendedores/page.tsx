import { redirect } from "next/navigation";

export default async function DashboardSorteoRevendedoresPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/sorteos/${id}/revendedores`);
}
