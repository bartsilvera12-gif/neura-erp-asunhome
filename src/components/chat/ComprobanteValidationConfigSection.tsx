"use client";

import type { ComprobanteValidationSettings } from "@/lib/chat/comprobante-validation-types";
import {
  ComprobanteValidationPanelComprobantesCore,
  ComprobanteValidationPanelDatosBancarios,
  ComprobanteValidationPanelMensajesYOcr,
} from "@/components/chat/ComprobanteValidationPanels";

/**
 * Vista continua (sin acordeón) de toda la validación de comprobantes.
 * Para el formulario de canal preferí `ComprobanteValidationPanel*` dentro de secciones colapsables.
 */
export function ComprobanteValidationConfigSection(props: {
  value: ComprobanteValidationSettings;
  onChange: (next: ComprobanteValidationSettings) => void;
}) {
  return (
    <div className="mt-8 pt-6 border-t border-slate-200 space-y-8">
      <ComprobanteValidationPanelComprobantesCore {...props} />
      <ComprobanteValidationPanelDatosBancarios {...props} />
      <ComprobanteValidationPanelMensajesYOcr {...props} />
    </div>
  );
}
