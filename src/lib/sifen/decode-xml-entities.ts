/** Decodifica entidades numéricas tipo &#243; que a veces vienen en mensajes SOAP de la SET. */
export function decodeXmlNumericEntities(s: string): string {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(String(n), 10)));
}
