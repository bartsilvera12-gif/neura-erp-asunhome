"use client";

import { createContext, useContext, useEffect } from "react";

/**
 * Tema visual del ERP: forzado a "light" para todos los usuarios.
 *
 * El modo nocturno previo se determinaba por `localStorage.neura_theme` o por
 * `prefers-color-scheme: dark` del sistema operativo. Confundía clientes y en algunas
 * pantallas la legibilidad caía. Decisión: ERP siempre en modo día.
 *
 * Este provider sigue presente para preservar el contrato del contexto (`useTheme`)
 * por si algún componente lo consume, pero:
 *  - Nunca aplica la clase `dark` al `<html>`.
 *  - Quita la clase `dark` si quedó persistida (DevTools / inercia previa).
 *  - Limpia `localStorage.neura_theme` para que un valor "dark" guardado no reactive nada.
 *  - `toggleTheme` queda como no-op intencional.
 *
 * Si en el futuro se quiere reintroducir dark mode, hay que reescribir este archivo;
 * no alcanza con cambiar variables en otra parte.
 */

type Theme = "light";

const STORAGE_KEY = "neura_theme";

type ThemeContextValue = {
  theme: Theme;
  toggleTheme: () => void;
};

// Value estatico extraido como const (theme siempre es "light").
// Si esto vive dentro del JSX del Provider, React crea un objeto nuevo en cada render
// y todos los useTheme() se invalidan sin razon.
const THEME_VALUE: ThemeContextValue = { theme: "light", toggleTheme: () => {} };

const ThemeContext = createContext<ThemeContextValue>(THEME_VALUE);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.remove("dark");
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /** Algunos navegadores bloquean localStorage (modo privado / cookies off); ignorar. */
    }
  }, []);

  return (
    <ThemeContext.Provider value={THEME_VALUE}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
