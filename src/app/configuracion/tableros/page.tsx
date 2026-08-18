"use client";

import { GitBranch, LayoutGrid } from "lucide-react";
import { GlobalConfigSubpageShell } from "@/components/config/GlobalConfigSubpageShell";
import { SettingsModuleCard } from "@/components/config/SettingsModuleCard";

export default function ConfiguracionTablerosPage() {
  const editorBadge = { label: "Editor", tone: "neutral" as const };

  return (
    <GlobalConfigSubpageShell
      title="Configuración de Tableros"
      description="Configurá etapas, columnas y tableros comerciales de la empresa sin mezclar los modelos internos de cada módulo."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <SettingsModuleCard
          title="CRM Funnel"
          subtitle="GLOBAL · PIPELINE"
          description="Etapas del pipeline comercial y embudo de leads."
          icon={GitBranch}
          badge={editorBadge}
          href="/configuracion/crm"
          actionLabel="Configurar CRM"
        />
        <SettingsModuleCard
          title="Proyectos Kanban"
          subtitle="GLOBAL · KANBAN"
          description="Columnas, estados y prioridades del tablero de proyectos."
          icon={LayoutGrid}
          badge={editorBadge}
          href="/configuracion/proyectos"
          actionLabel="Configurar Proyectos"
        />
      </div>
    </GlobalConfigSubpageShell>
  );
}
