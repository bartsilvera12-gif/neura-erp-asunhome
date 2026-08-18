const STORAGE_KEY = "neura_favoritos";

export function getFavoritos(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function setFavoritos(ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // ignore
  }
}

export function toggleFavorito(id: string): string[] {
  const current = getFavoritos();
  const next = current.includes(id)
    ? current.filter((x) => x !== id)
    : [...current, id];
  setFavoritos(next);
  return next;
}
