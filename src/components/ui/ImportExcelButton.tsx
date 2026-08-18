"use client";

import { useState } from "react";
import ExcelImportWizard from "./ExcelImportWizard";

interface Props {
  entidad: string;
  previewUrl: string;
  commitUrl: string;
  templateUrl: string;
  permiteCrearFaltantes?: boolean;
  className?: string;
  /** Si false, el boton no se renderiza (admin-only). */
  visible?: boolean;
  onCompleted?: () => void;
}

export default function ImportExcelButton({
  entidad, previewUrl, commitUrl, templateUrl,
  permiteCrearFaltantes, className = "",
  visible = true, onCompleted,
}: Props) {
  const [open, setOpen] = useState(false);
  if (!visible) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          "inline-flex items-center gap-1.5 text-sm font-medium text-indigo-700 hover:text-indigo-900 border border-indigo-200 hover:bg-indigo-50 px-3 py-2 rounded-lg transition-colors " +
          className
        }
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
          <path d="M9.25 13.25a.75.75 0 0 0 1.5 0V4.636l2.955 3.129a.75.75 0 0 0 1.09-1.03l-4.25-4.5a.75.75 0 0 0-1.09 0l-4.25 4.5a.75.75 0 0 0 1.09 1.03L9.25 4.636v8.614Z" />
          <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
        </svg>
        Importar Excel
      </button>
      {open && (
        <ExcelImportWizard
          entidad={entidad}
          previewUrl={previewUrl}
          commitUrl={commitUrl}
          templateUrl={templateUrl}
          permiteCrearFaltantes={permiteCrearFaltantes}
          onClose={() => setOpen(false)}
          onCompleted={onCompleted}
        />
      )}
    </>
  );
}
