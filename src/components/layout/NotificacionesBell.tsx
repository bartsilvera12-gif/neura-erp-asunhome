"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, PackageX } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

interface Notif {
  id: string;
  tipo: string;
  titulo: string;
  mensaje: string;
  producto_id: string | null;
  url: string | null;
  leida: boolean;
  created_at: string;
}

const POLL_MS = 60_000;

/** Sonido corto de "ding" via Web Audio API (sin archivo externo). */
function playDing() {
  try {
    const AudioCtx = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.08);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.25, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.4);
  } catch { /* audio no disponible */ }
}

export default function NotificacionesBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [noLeidas, setNoLeidas] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const prevNoLeidas = useRef<number | null>(null);

  const cargar = useCallback(async () => {
    try {
      const res = await fetchWithSupabaseSession("/api/notificaciones", { cache: "no-store" });
      if (!res.ok) return;
      const j = await res.json();
      const data = j?.data as { notificaciones?: Notif[]; no_leidas?: number } | undefined;
      const nuevoNo = data?.no_leidas ?? 0;
      setItems(data?.notificaciones ?? []);
      setNoLeidas(nuevoNo);
      // Ding solo si aumentó respecto al último valor conocido (evita sonar en el primer poll).
      if (prevNoLeidas.current !== null && nuevoNo > prevNoLeidas.current) {
        playDing();
      }
      prevNoLeidas.current = nuevoNo;
    } catch {
      /* silencioso: la campanita no debe romper la UI */
    }
  }, []);

  useEffect(() => {
    void cargar();
    const t = setInterval(() => void cargar(), POLL_MS);
    return () => clearInterval(t);
  }, [cargar]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  async function abrirNotif(n: Notif) {
    // Optimista: marcar leída localmente.
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, leida: true } : x)));
    setNoLeidas((c) => (n.leida ? c : Math.max(0, c - 1)));
    setOpen(false);
    try {
      await fetchWithSupabaseSession(`/api/notificaciones/${n.id}/leer`, { method: "POST" });
    } catch { /* noop */ }
    if (n.url) router.push(n.url);
  }

  async function marcarTodas() {
    setItems((prev) => prev.map((x) => ({ ...x, leida: true })));
    setNoLeidas(0);
    try {
      await fetchWithSupabaseSession("/api/notificaciones/leer-todas", { method: "POST" });
    } catch { /* noop */ }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-50 hover:text-[#3F8E91]"
        aria-label="Notificaciones"
      >
        <Bell className="h-5 w-5" />
        {noLeidas > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {noLeidas > 9 ? "9+" : noLeidas}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl ring-1 ring-[#4FAEB2]/15">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">Notificaciones</p>
            {items.some((x) => !x.leida) && (
              <button onClick={marcarTodas} className="text-xs font-medium text-[#3F8E91] hover:underline">
                Marcar todas
              </button>
            )}
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-slate-400">
                <Bell className="mx-auto mb-2 h-6 w-6 text-slate-300" />
                Sin notificaciones
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => abrirNotif(n)}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 ${n.leida ? "" : "bg-[#4FAEB2]/5"}`}
                    >
                      <span className={`mt-0.5 shrink-0 rounded-lg p-1.5 ${n.leida ? "bg-slate-100 text-slate-400" : "bg-red-50 text-red-600"}`}>
                        <PackageX className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-xs font-bold text-slate-800">{n.titulo}</span>
                          {!n.leida && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />}
                        </span>
                        <span className="mt-0.5 block text-xs leading-snug text-slate-500">{n.mensaje}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
