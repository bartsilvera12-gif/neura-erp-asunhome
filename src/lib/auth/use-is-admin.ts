"use client";

import { useEffect, useState } from "react";

/** Hook simple: devuelve true si el usuario actual tiene rol admin. */
export function useIsAdmin(): { isAdmin: boolean; loaded: boolean } {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancel = false;
    fetch("/api/me/rol", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancel) return;
        setIsAdmin(j?.success && j.data?.isAdmin === true);
        setLoaded(true);
      })
      .catch(() => { if (!cancel) setLoaded(true); });
    return () => { cancel = true; };
  }, []);
  return { isAdmin, loaded };
}
