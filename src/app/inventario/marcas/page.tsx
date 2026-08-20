import MaestroProductoPage from "@/components/inventario/MaestroProductoPage";

export default function MarcasPage() {
  return (
    <MaestroProductoPage
      kind="marcas"
      titulo="Marcas"
      descripcion="Marcas de los productos. Alimentan el reporte por marca y la trazabilidad de equipos averiados hacia su proveedor."
      placeholderNombre="Ej: Samsung"
      conProveedor
    />
  );
}
