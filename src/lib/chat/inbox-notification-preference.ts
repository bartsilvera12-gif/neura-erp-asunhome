/**
 * Preferencia del operador: sonido al recibir mensajes entrantes en el inbox.
 * Persistencia solo en el navegador (localStorage), por usuario/máquina.
 */

const STORAGE_KEY = "neura_erp_inbox_notification_sound";

export function readInboxNotificationSoundEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === null) return false;
    return v === "1" || v === "true";
  } catch {
    return false;
  }
}

export function writeInboxNotificationSoundEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/** Tono corto (~150 ms), sin archivo externo. */
export function playInboxNotificationBeep(): void {
  if (typeof window === "undefined") return;
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.06;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const t0 = ctx.currentTime;
    osc.start(t0);
    osc.stop(t0 + 0.12);
    osc.onended = () => {
      void ctx.close().catch(() => {});
    };
  } catch {
    /* ignore */
  }
}
