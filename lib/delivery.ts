export const mesas = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI"];
export type Delivery = { folio: string; mesa?: string; nombre?: string; direccion?: string; operador?: string; tieneINE?: boolean; fecha: string; lat: string; lng: string; precision: string };
const nameLabel = /\bN[O0]M[B8]R[E3](?:\(S\))?\b/i;
const addressLabel = /\b(?:D[O0]M[I1L]C[I1L]L[I1L][O0]|DIRECCI[ÓO0]N)\b/i;
const stopLabel = /\b(?:CLAVE(?:\s+DE)?\s+ELECTOR|CURP|FECHA|SEXO|SECCI[ÓO0]N|VIGENCIA|EMISI[ÓO0]N|REGISTRO|ESTADO|MUNICIPIO\s*[:：]|LOCALIDAD\s*[:：])\b/i;
const heading = /INSTITUTO|NACIONAL ELECTORAL|CREDENCIAL|PARA VOTAR|ESTADOS UNIDOS|M[ÉE]XICO$/i;
const clean = (line: string) => line.replace(/^[^A-ZÁÉÍÓÚÜÑ0-9]+/i, "").replace(/[|_]+/g, " ").replace(/\s+/g, " ").trim();
function section(text: string, kind: "nombre" | "direccion", region = false) {
  const label = kind === "nombre" ? nameLabel : addressLabel;
  const other = kind === "nombre" ? addressLabel : nameLabel;
  const lines = text.split(/\r?\n/).map(clean).filter(Boolean);
  const start = lines.findIndex(line => label.test(line));
  if (start < 0 && !region) return "";
  const found: string[] = [];
  const max = kind === "nombre" ? 3 : 4;
  for (let i = start >= 0 ? start : 0; i < lines.length && found.length < max; i++) {
    let line = lines[i];
    if (i === start) line = line.slice((line.match(label)?.index ?? 0) + (line.match(label)?.[0].length ?? 0)).replace(/^\s*[:：.)-]+\s*/, "");
    const otherIndex = line.search(other);
    const endOfSection = otherIndex >= 0;
    if (endOfSection) line = line.slice(0, otherIndex);
    const stop = line.search(stopLabel);
    const finished = stop >= 0;
    if (finished) line = line.slice(0, stop);
    line = clean(line);
    if (line && !heading.test(line)) {
      // Names must contain letters, never dates or voter identifiers.
      if (kind === "nombre" && /\d/.test(line)) break;
      if (/[A-ZÁÉÍÓÚÜÑ]{2}/i.test(line)) found.push(line);
    }
    // SEXO often sits to the right of NOMBRE on the same printed row.
    if (endOfSection) break;
    if (finished && !/SEXO/i.test(lines[i].slice(stop)) && !(i === start && found.length === 0)) break;
  }
  const value = found.join(" ").trim();
  if (kind === "nombre" && value.split(/\s+/).length < 2) return "";
  return value;
}
export function parseINE(text: string) {
  return { nombre: section(text, "nombre"), direccion: section(text, "direccion") };
}
export function parseINERegion(text: string, kind: "nombre" | "direccion") {
  return section(text, kind, true);
}

