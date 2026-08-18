"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  productoId: string;
  initialUrl?: string | null;
  initialPath?: string | null;
  onChange?: (info: { imagen_path: string | null; imagen_url: string | null }) => void;
}

const ACCEPT = "image/jpeg,image/png,image/webp";

/**
 * Uploader server-mediated. Requiere que el producto ya exista (productoId valido).
 * Sube via POST /api/productos/[id]/imagen y persiste imagen_path en DB.
 */
export default function ProductImageUploader({ productoId, initialUrl, initialPath, onChange }: Props) {
  const [url, setUrl] = useState<string | null>(initialUrl ?? null);
  const [hasImage, setHasImage] = useState<boolean>(!!initialPath);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Si arranco con path pero sin url firmada, pedir signed URL fresca
  useEffect(() => {
    let cancelled = false;
    if (initialPath && !initialUrl) {
      (async () => {
        try {
          const res = await fetch(`/api/productos/${productoId}/imagen`, { credentials: "include" });
          const json = await res.json();
          if (!cancelled && res.ok && json?.success) {
            setUrl(json.data?.imagen_url ?? null);
            setHasImage(!!json.data?.imagen_path);
          }
        } catch { /* ignore */ }
      })();
    }
    return () => { cancelled = true; };
  }, [productoId, initialPath, initialUrl]);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", f);
      const res = await fetch(`/api/productos/${productoId}/imagen`, {
        method: "POST",
        body: form,
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        setError(json?.error ?? "No se pudo subir la imagen");
      } else {
        setUrl(json.data?.imagen_url ?? null);
        setHasImage(true);
        onChange?.({ imagen_path: json.data?.imagen_path ?? null, imagen_url: json.data?.imagen_url ?? null });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de red");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleRemove() {
    if (!hasImage) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/productos/${productoId}/imagen`, {
        method: "DELETE",
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        setError(json?.error ?? "No se pudo quitar la imagen");
      } else {
        setUrl(null);
        setHasImage(false);
        onChange?.({ imagen_path: null, imagen_url: null });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de red");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-4">
        <div className="w-28 h-28 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="Imagen del producto" className="w-full h-full object-cover" />
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-8 h-8 text-slate-300">
              <path fillRule="evenodd" d="M1 5.25A2.25 2.25 0 0 1 3.25 3h13.5A2.25 2.25 0 0 1 19 5.25v9.5A2.25 2.25 0 0 1 16.75 17H3.25A2.25 2.25 0 0 1 1 14.75v-9.5Zm1.5 5.81v3.69c0 .414.336.75.75.75h13.5a.75.75 0 0 0 .75-.75v-2.69l-2.22-2.219a.75.75 0 0 0-1.06 0l-1.91 1.909.47.47a.75.75 0 1 1-1.06 1.06L6.53 8.091a.75.75 0 0 0-1.06 0L2.5 11.06ZM12 6.5a1 1 0 1 1 2 0 1 1 0 0 1-2 0Z" clipRule="evenodd" />
            </svg>
          )}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white text-sm px-4 py-2 rounded-lg disabled:opacity-50"
            >
              {busy ? "Subiendo..." : hasImage ? "Cambiar imagen" : "Subir imagen"}
            </button>
            {hasImage && (
              <button
                type="button"
                onClick={handleRemove}
                disabled={busy}
                className="text-sm text-red-600 hover:text-red-800 px-3 py-2 rounded-lg border border-slate-200 hover:bg-red-50 disabled:opacity-50"
              >
                Quitar
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={handleFile}
            />
          </div>
          <p className="mt-1.5 text-xs text-slate-400">
            JPG, PNG o WebP — máx. 5 MB.
          </p>
          {error && (
            <p className="mt-1.5 text-xs text-red-600">{error}</p>
          )}
        </div>
      </div>
    </div>
  );
}
