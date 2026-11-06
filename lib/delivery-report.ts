import { mesas, type Delivery } from "./delivery";
export type HistoryOptions = { mesa: string; q: string; pagina: number; limite: number; exportar: boolean };
export type HistoryPage = { items: Delivery[]; total: number; pagina: number; limite: number; paginas: number; mesa: string; q: string };
export type MesaTotal = { mesa: string; total: number; conINE: number; sinINE: number; primera: string | null; ultima: string | null };
export type DeliverySummary = { total: number; conINE: number; sinINE: number; sinMesa: number; mesasActivas: number; primera: string | null; ultima: string | null; generado: string; porMesa: MesaTotal[] };
type Row = { mesa: string; numero: number; nombre: string; direccion: string; operador: string; tiene_ine: number; fecha: string; lat: number; lng: number; precision: number };
export function historyOptions(params: URLSearchParams): HistoryOptions {
  const mesa = params.get("mesa") ?? "";
  const q = (params.get("q") ?? "").trim().toUpperCase();
  const pagina = Number(params.get("pagina") ?? "1"), limite = Number(params.get("limite") ?? "25");
  const exportar = params.get("exportar") === "1";
  if ((mesa && mesa !== "sin-mesa" && !mesas.includes(mesa)) || q.length > 40 || !Number.isSafeInteger(pagina) || pagina < 1 || !Number.isSafeInteger(limite) || limite < 1 || limite > 150) throw Error("Revisa la mesa, el folio y la página solicitada.");
  if (exportar && (!mesa || q)) throw Error("Selecciona una mesa para exportar sus entregas.");
  return { mesa, q, pagina, limite, exportar };
}
async function legacyRecords(bucket: R2Bucket): Promise<Delivery[]> {
  // Only records from the original version live under entregas/. New photos
  // use evidencias/ and ine/; they are never listed to paginate the history.
  const records: Delivery[] = [];
  let cursor: string | undefined;
  do {
    const options: R2ListOptions & { include: string[] } = { prefix: "entregas/", cursor, include: ["customMetadata"] };
    const page = await bucket.list(options);
    for (const item of page.objects) records.push({ ...item.customMetadata, folio: item.key.slice(9), fecha: item.uploaded.toISOString(), tieneINE: false } as Delivery);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return records.sort((a, b) => b.fecha.localeCompare(a.fecha) || a.folio.localeCompare(b.folio));
}
export async function deliveryPage(db: D1Database, bucket: R2Bucket, options: HistoryOptions): Promise<HistoryPage> {
  const { mesa, q, limite, exportar } = options;
  const legacy = !mesa || mesa === "sin-mesa" ? (await legacyRecords(bucket)).filter(row => row.folio.includes(q)) : [];
  const clauses: string[] = [], bindings: string[] = [];
  if (mesa && mesa !== "sin-mesa") { clauses.push("mesa = ?"); bindings.push(mesa); }
  if (q) { clauses.push("instr(upper(mesa || '-' || numero), ?) > 0"); bindings.push(q); }
  const where = clauses.length ? " WHERE " + clauses.join(" AND ") : "";
  const count = mesa === "sin-mesa" ? null : await db.prepare("SELECT COUNT(*) AS total FROM deliveries" + where).bind(...bindings).first<{ total: number }>();
  const dbTotal = Number(count?.total ?? 0);
  const total = dbTotal + legacy.length, paginas = Math.max(1, Math.ceil(total / limite));
  const pagina = Math.min(options.pagina, paginas), offset = (pagina - 1) * limite;
  let items: Delivery[] = [];
  if (offset < dbTotal) {
    const order = exportar ? "numero ASC" : "fecha DESC, id DESC";
    const rows = await db.prepare("SELECT mesa, numero, nombre, direccion, operador, tiene_ine, fecha, lat, lng, precision FROM deliveries" + where + " ORDER BY " + order + " LIMIT ? OFFSET ?").bind(...bindings, Math.min(limite, dbTotal - offset), offset).all<Row>();
    items = rows.results.map(row => ({ folio: row.mesa + "-" + row.numero, mesa: row.mesa, nombre: row.nombre, direccion: row.direccion, operador: row.operador, tieneINE: row.tiene_ine === 1, fecha: row.fecha, lat: String(row.lat), lng: String(row.lng), precision: String(row.precision) }));
  }
  if (items.length < limite) items.push(...legacy.slice(Math.max(0, offset - dbTotal), Math.max(0, offset - dbTotal) + limite - items.length));
  return { items, total, pagina, limite, paginas, mesa, q };
}
export async function deliverySummary(db: D1Database, bucket: R2Bucket): Promise<DeliverySummary> {
  const rows = await db.prepare("SELECT mesa, COUNT(*) AS total, COALESCE(SUM(tiene_ine), 0) AS conINE, MIN(fecha) AS primera, MAX(fecha) AS ultima FROM deliveries GROUP BY mesa").all<{ mesa: string; total: number; conINE: number; primera: string; ultima: string }>();
  const porMesa: MesaTotal[] = mesas.map(mesa => {
    const row = rows.results.find(row => row.mesa === mesa);
    const total = Number(row?.total ?? 0), conINE = Number(row?.conINE ?? 0);
    return { mesa, total, conINE, sinINE: total - conINE, primera: row?.primera ?? null, ultima: row?.ultima ?? null };
  });
  const legacy = await legacyRecords(bucket);
  const total = porMesa.reduce((sum, row) => sum + row.total, legacy.length);
  const conINE = porMesa.reduce((sum, row) => sum + row.conINE, 0);
  const dates = [...porMesa.flatMap(row => [row.primera, row.ultima]), ...legacy.map(row => row.fecha)].filter((value): value is string => !!value).sort();
  return { total, conINE, sinINE: total - conINE, sinMesa: legacy.length, mesasActivas: porMesa.filter(row => row.total > 0).length, primera: dates[0] ?? null, ultima: dates.at(-1) ?? null, generado: new Date().toISOString(), porMesa };
}

