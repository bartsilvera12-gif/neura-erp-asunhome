import type { SifenCancelacionPreview } from "@/lib/sifen/sifen-cancelacion-rules";

export type ModoCambioPlan = "inmediato" | "proximo_mes" | "actualizar_factura_pendiente";
export type CasoCambioPlan = "A" | "B" | "C" | "D" | "sin_suscripcion";

export type CambioPlanContexto = {
  caso: CasoCambioPlan;
  aviso: string | null;
  avisoBloqueo: string | null;
  hoy: string;
  vigenciaProximoMes: string;
  modos_permitidos: ModoCambioPlan[];
  factura_id_periodo: string | null;
  factura_monto: number | null;
  factura_saldo: number | null;
  factura_moneda: string | null;
  factura_estado: string | null;
  sifen: {
    tiene_de: boolean;
    estado: string | null;
    aprobado: boolean;
    plazo_cancelacion_horas: number;
    cancelacion: SifenCancelacionPreview | null;
  };
  tieneFacturaComercialPeriodo: boolean;
  puedeActualizarFacturaPendiente: boolean;
  suscripcion: {
    id: string;
    plan_id: string | null;
    plan_nombre: string;
    precio: number;
    moneda: string;
    plan_pendiente_id: string | null;
    plan_pendiente_nombre: string | null;
    plan_pendiente_vigente_desde: string | null;
  } | null;
  planes: { id: string; nombre: string; precio: number; moneda: string }[];
};
