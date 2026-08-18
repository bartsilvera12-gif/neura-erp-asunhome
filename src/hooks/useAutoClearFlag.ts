import { useEffect, useRef, useState } from "react";

/**
 * Hook para mensajes/banners de éxito/error que deben auto-limpiarse después de N ms.
 *
 * Reemplaza el patrón inseguro:
 *
 *   const [success, setSuccess] = useState(false);
 *   setSuccess(true);
 *   setTimeout(() => setSuccess(false), 3000); // ← leak si el componente se desmonta antes
 *
 * Por el patrón correcto:
 *
 *   const [success, setSuccess] = useAutoClearFlag(3000);
 *   setSuccess(true); // ← se limpia solo a los 3000ms, y se cancela si el componente se desmonta.
 *
 * Garantías:
 *  - Si el componente se desmonta antes de que dispare el timer, se hace clearTimeout
 *    (no hay setState-after-unmount warnings).
 *  - Si se llama setSuccess(true) de nuevo antes de que termine el timer anterior,
 *    se cancela el anterior y se arma uno nuevo (timer único, no overlap).
 *  - setSuccess(false) cancela el timer pendiente sin disparar setState extra.
 */
export function useAutoClearFlag<T>(
  clearAfterMs: number,
  initialValue: T | null = null,
): [T | null, (next: T | null) => void] {
  const [value, setValueRaw] = useState<T | null>(initialValue);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup al desmontar: cancela cualquier timer pendiente.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const setValue = (next: T | null) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setValueRaw(next);
    if (next !== null && clearAfterMs > 0) {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setValueRaw(null);
      }, clearAfterMs);
    }
  };

  return [value, setValue];
}
