"use client";

import {
  DEFAULT_BUSINESS_AUTOMATION_TIMEZONE,
  type BusinessAutomationSettings,
  type BusinessHoursPreset,
} from "@/lib/chat/channel-business-automation-types";

const COMMON_TZ = [
  "America/Asuncion",
  "America/Argentina/Buenos_Aires",
  "America/Sao_Paulo",
  "America/Mexico_City",
  "America/New_York",
  "Europe/Madrid",
  "UTC",
] as const;

type Props = {
  value: BusinessAutomationSettings;
  onChange: (next: BusinessAutomationSettings) => void;
};

export function BusinessAutomationConfigSection({ value: s, onChange }: Props) {
  const patch = (p: Partial<BusinessAutomationSettings>) => onChange({ ...s, ...p });

  return (
    <div className="space-y-5">
      <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3">
        <input
          type="checkbox"
          className="mt-1"
          checked={s.master_enabled}
          onChange={(e) => patch({ master_enabled: e.target.checked })}
        />
        <span>
          <span className="block text-sm font-medium text-slate-800">
            Activar mensajes automáticos (capa liviana)
          </span>
          <span className="block text-xs text-slate-500 mt-0.5">
            No reemplaza flujos/bot: son respuestas simples por canal, evaluadas en el webhook al recibir mensajes.
          </span>
        </span>
      </label>

      <div className={`space-y-4 ${!s.master_enabled ? "opacity-[0.88]" : ""}`}>
        {!s.master_enabled ? (
          <p className="text-xs text-amber-800/90 bg-amber-50 border border-amber-200/80 rounded-lg px-3 py-2">
            La capa liviana está desactivada: igual podés editar y guardar; el webhook solo usará estos mensajes
            cuando actives el interruptor superior.
          </p>
        ) : null}
        <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h4 className="text-sm font-semibold text-slate-800">Mensaje de bienvenida</h4>
              <p className="text-xs text-slate-500 mt-0.5">
                Se envía tras el <strong>primer</strong> mensaje entrante del cliente en la conversación (nuevo hilo).
                Podés editar el texto siempre; <strong>Activar</strong> solo define si se usa al recibir mensajes.
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700 shrink-0">
              <input
                type="checkbox"
                checked={s.welcome_enabled}
                onChange={(e) => patch({ welcome_enabled: e.target.checked })}
              />
              Usar mensaje
            </label>
          </div>
          <textarea
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm min-h-[88px] bg-white"
            value={s.welcome_message}
            onChange={(e) => patch({ welcome_message: e.target.value })}
            placeholder="Texto de bienvenida…"
          />
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h4 className="text-sm font-semibold text-slate-800">Horario de atención</h4>
              <p className="text-xs text-slate-500 mt-0.5">
                Define cuándo se considera “en horario”. Fuera de este rango puede enviarse el mensaje de ausencia.
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700 shrink-0">
              <input
                type="checkbox"
                checked={s.hours_enabled}
                onChange={(e) => patch({ hours_enabled: e.target.checked })}
              />
              Activar
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Zona horaria</label>
              <select
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                value={
                  (COMMON_TZ as readonly string[]).includes(s.timezone) ? s.timezone : "__custom__"
                }
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "__custom__") return;
                  patch({ timezone: v });
                }}
                disabled={!s.hours_enabled}
              >
                {COMMON_TZ.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
                <option value="__custom__">Otra (editar abajo)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Días</label>
              <select
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                value={s.schedule_preset}
                onChange={(e) => patch({ schedule_preset: e.target.value as BusinessHoursPreset })}
                disabled={!s.hours_enabled}
              >
                <option value="mon_fri">Lunes a viernes</option>
                <option value="all_days">Todos los días</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Desde (24 h)</label>
              <input
                type="time"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                value={s.day_start.length === 5 ? s.day_start : "08:00"}
                onChange={(e) => patch({ day_start: e.target.value || "08:00" })}
                disabled={!s.hours_enabled}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Hasta (24 h)</label>
              <input
                type="time"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                value={s.day_end.length === 5 ? s.day_end : "18:00"}
                onChange={(e) => patch({ day_end: e.target.value || "18:00" })}
                disabled={!s.hours_enabled}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">
                Zona horaria (texto IANA si usás “Otra”)
              </label>
              <input
                type="text"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono bg-white"
                value={s.timezone}
                onChange={(e) => patch({ timezone: e.target.value || DEFAULT_BUSINESS_AUTOMATION_TIMEZONE })}
                placeholder={DEFAULT_BUSINESS_AUTOMATION_TIMEZONE}
                disabled={!s.hours_enabled}
              />
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h4 className="text-sm font-semibold text-slate-800">Mensaje fuera de horario</h4>
              <p className="text-xs text-slate-500 mt-0.5">
                Si el horario de atención está activo y el mensaje llega fuera de ese rango, se responde con este
                texto (con pausa entre reenvíos para no spamear).
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700 shrink-0">
              <input
                type="checkbox"
                checked={s.away_enabled}
                onChange={(e) => patch({ away_enabled: e.target.checked })}
              />
              Activar
            </label>
          </div>
          <textarea
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm min-h-[88px] bg-white"
            value={s.away_message}
            onChange={(e) => patch({ away_message: e.target.value })}
            placeholder="Ej: Volvé a escribirnos de 8 a 18 hs…"
          />
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">
              Mínimo entre avisos fuera de horario (minutos)
            </label>
            <input
              type="number"
              min={15}
              max={10080}
              className="w-full max-w-[200px] border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
              value={s.away_cooldown_minutes}
              onChange={(e) =>
                patch({
                  away_cooldown_minutes: Math.min(10080, Math.max(15, Math.trunc(Number(e.target.value)) || 360)),
                })
              }
              disabled={!s.away_enabled || !s.hours_enabled}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
