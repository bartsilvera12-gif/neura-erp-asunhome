"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getSorteoById } from "@/lib/sorteos/actions";
import { listRevendedoresBySorteo } from "@/lib/sorteos/revendedores-actions";
import SorteoRevendedoresClient from "./SorteoRevendedoresClient";

export default function SorteoRevendedoresPage() {
  const params = useParams();
  const id = String(params?.id ?? "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nombreSorteo, setNombreSorteo] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [rows, setRows] = useState<Awaited<ReturnType<typeof listRevendedoresBySorteo>>>([]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setBaseUrl(window.location.origin);
    }
  }, []);

  useEffect(() => {
    if (!id) return;
    let cancel = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [sorteo, revendedores] = await Promise.all([
          getSorteoById(id),
          listRevendedoresBySorteo(id),
        ]);
        if (cancel) return;
        if (!sorteo) {
          setError("Sorteo no encontrado o sin permisos.");
          return;
        }
        setNombreSorteo(sorteo.nombre);
        setRows(revendedores);
      } catch (e) {
        if (cancel) return;
        setError(e instanceof Error ? e.message : "Error al cargar revendedores");
      } finally {
        if (!cancel) setLoading(false);
      }
    }
    void load();
    return () => {
      cancel = true;
    };
  }, [id]);

  if (loading) {
    return <div className="py-16 text-center text-slate-400 text-sm animate-pulse">Cargando revendedores…</div>;
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg px-4 py-2">{error}</div>
        <Link href="/sorteos" className="text-sm text-[#0EA5E9] hover:underline">
          Volver a sorteos
        </Link>
      </div>
    );
  }

  return (
    <SorteoRevendedoresClient
      sorteoId={id}
      sorteoNombre={nombreSorteo}
      initialRows={rows}
      baseUrl={baseUrl}
    />
  );
}
