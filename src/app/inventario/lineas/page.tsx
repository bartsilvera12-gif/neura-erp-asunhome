import MaestroProductoPage from "@/components/inventario/MaestroProductoPage";

export default function LineasProductoPage() {
  return (
    <MaestroProductoPage
      kind="lineas-producto"
      titulo="Líneas de producto"
      descripcion="Agrupación comercial de los productos (distinta de las categorías). Alimenta el reporte por línea de productos."
      placeholderNombre="Ej: Electrodomésticos"
    />
  );
}
