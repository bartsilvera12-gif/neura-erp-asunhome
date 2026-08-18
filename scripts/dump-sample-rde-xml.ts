/**
 * Emite un rDE de muestra a stdout para validación XSD (uso puntual).
 */
import { buildOfficialRdeFacturaElectronicaXml } from "../src/lib/sifen/rde-xml";
import type { SifenFacturaPayloadBase } from "../src/lib/sifen/types";

const base: SifenFacturaPayloadBase = {
  emisor: {
    ruc: "80000001-1",
    razon_social: "EMPRESA DEMO S.A.",
    direccion_fiscal: "Calle Principal 123",
    timbrado_numero: "12345678",
    timbrado_fecha_inicio_vigencia: "2025-01-01",
    actividad_economica_codigo: "47111",
    actividad_economica_descripcion: "Comercio al por menor",
    establecimiento: "001",
    punto_expedicion: "001",
    csc: "123456789",
  },
  documento: {
    factura_id: "00000000-0000-0000-0000-000000000001",
    numero_factura: "1",
    fecha: "2026-04-04",
    tipo: "contado",
    moneda: "GS",
    monto: 11000,
    saldo: 0,
  },
  receptor: {
    cliente_id: "c1",
    nombre: "Cliente Final",
    documento: "1234567",
    ruc: null,
    direccion: "Av. Demo 100",
    telefono: "0981123456",
    email: "cli@example.com",
  },
  items: [
    {
      descripcion: "Producto IVA 10%",
      cantidad: 1,
      precio_unitario: 10000,
      subtotal: 10000,
      iva: 1000,
      total: 11000,
    },
  ],
  sifen: {
    factura_electronica_id: "fe-sample-1",
    estado_sifen: "borrador",
  },
};

const xml = buildOfficialRdeFacturaElectronicaXml(base, {
  timbradoFechaInicio: "2025-01-01",
  timbradoFechaFin: "2026-12-31",
  emisorTelefono: "0981234567",
  emisorEmail: "facturacion@empresa.com.py",
  emisorDireccion: "Calle Principal 123",
  emisorNumCasa: 0,
  actividadEconomicaCodigo: "47111",
  actividadEconomicaDescripcion: "Comercio al por menor",
  fechaHoraEmision: new Date("2026-04-04T12:00:00"),
});

process.stdout.write(xml);
