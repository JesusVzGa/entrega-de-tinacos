import { env } from "cloudflare:workers";
import { getAppSession, sameOrigin } from "../../../lib/app-session";
import { isAdmin } from "../../../lib/admin";
import { mesas, type Delivery } from "../../../lib/delivery";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
type Row = { id: string; mesa: string; numero: number; nombre: string; direccion: string; fecha: string; lat: number; lng: number; precision: number; user_id: string; operador: string; tiene_ine: number };
export async function GET(request: Request) {
  const user = await getAppSession(request);
  if (!user) return json({ error: "Inicia sesión." }, 401);
  if (!isAdmin(user)) return json({ error: "Solo el administrador puede consultar el historial y las fotos." }, 403);
  const bucket = env.BUCKET;
  if (!bucket || !env.DB) return json({ error: "Almacenamiento no disponible." }, 503);
  const folio = new URL(request.url).searchParams.get("foto");
  if (folio !== null) {
    if (!/^[A-Z0-9][A-Z0-9-]{0,39}$/.test(folio)) return json({ error: "Folio inválido." }, 400);
    const match = /^(I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV|XVI)-(\d+)$/.exec(folio);
    const kind = new URL(request.url).searchParams.get("tipo") ?? "entrega";
    if (kind !== "ine" && kind !== "entrega") return json({ error: "Tipo de foto inválido." }, 400);
    const row = match ? await env.DB.prepare("SELECT id, tiene_ine FROM deliveries WHERE mesa = ? AND numero = ?").bind(match[1], Number(match[2])).first<{ id: string; tiene_ine: number }>() : null;
    if (kind === "ine" && !row?.tiene_ine) return json({ error: "Este registro no tiene foto de INE." }, 404);
    const key = kind === "ine" ? "ine/" + row!.id : row ? "evidencias/" + row.id : "entregas/" + folio;
    const photo = await bucket.get(key);
    if (!photo) return json({ error: "Foto no encontrada." }, 404);
    return new Response(photo.body, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  }
  const result = await env.DB.prepare("SELECT * FROM deliveries ORDER BY fecha DESC").all<Row>();
  const records: Delivery[] = result.results.map(row => ({ operador: row.operador, tieneINE: row.tiene_ine === 1, mesa: row.mesa, nombre: row.nombre, direccion: row.direccion, fecha: row.fecha, folio: row.mesa + "-" + row.numero, lat: String(row.lat), lng: String(row.lng), precision: String(row.precision) }));
  let cursor: string | undefined;
  do {
    const options: R2ListOptions & { include: string[] } = { prefix: "entregas/", cursor, include: ["customMetadata"] };
    const page = await bucket.list(options);
    for (const item of page.objects) records.push({ ...item.customMetadata, folio: item.key.slice(9), fecha: item.uploaded.toISOString() } as Delivery);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  records.sort((a, b) => b.fecha.localeCompare(a.fecha));
  return json(records);
}
export async function POST(request: Request) {
  const user = await getAppSession(request);
  if (!user) return json({ error: "Inicia sesión." }, 401);
  if (!sameOrigin(request)) return json({ error: "Abre la aplicación directamente." }, 403);
  const bucket = env.BUCKET, db = env.DB;
  if (!bucket || !db) return json({ error: "Almacenamiento no disponible." }, 503);
  const id = request.headers.get("x-request-id") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: "Identificador inválido." }, 400);
  const existing = await db.prepare("SELECT * FROM deliveries WHERE id = ?").bind(id).first<Row>();
  if (existing) return existing.user_id === user.userId ? json({ folio: existing.mesa + "-" + existing.numero }) : json({ error: "Identificador ocupado." }, 409);
  if (Number(request.headers.get("content-length")) > 18 * 1024 * 1024) return json({ error: "Cada foto debe pesar menos de 8 MB." }, 413);
  let form: FormData;
  try { form = await request.formData(); } catch { return json({ error: "Formulario inválido." }, 400); }
  const mesa = String(form.get("mesa") ?? "");
  const nombre = String(form.get("nombre") ?? "").trim();
  const direccion = String(form.get("direccion") ?? "").trim();
  const values = ["lat", "lng", "precision"].map(key => String(form.get(key) ?? ""));
  const [lat, lng, precision] = values.map(Number);
  if (!mesas.includes(mesa) || !nombre || nombre.length > 160 || !direccion || direccion.length > 500 || form.get("confirmado") !== "si" || values.some(v => !v.trim()) || ![lat, lng, precision].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || precision < 0) return json({ error: "Revisa la mesa, el nombre, la dirección y la ubicación; confirma los datos." }, 400);
  async function imageBytes(value: FormDataEntryValue | null) {
    if (!(value instanceof File) || value.size > 8 * 1024 * 1024 || value.size < 3) return null;
    const bytes = new Uint8Array(await value.arrayBuffer());
    return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? bytes : null;
  }
  const [bytes, ine] = await Promise.all([imageBytes(form.get("foto")), imageBytes(form.get("ine"))]);
  if (!bytes || !ine) return json({ error: "Adjunta la foto de la entrega y la INE, ambas en JPEG y de hasta 8 MB cada una." }, 400);
  const options = { onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType: "image/jpeg" } };
  await bucket.put("evidencias/" + id, bytes, options);
  await bucket.put("ine/" + id, ine, options);
  // One atomic statement allocates each mesa's sequence; the request ID makes retries safe.
  await db.prepare("INSERT INTO deliveries (id, mesa, numero, nombre, direccion, lat, lng, precision, fecha, user_id, operador, tiene_ine) SELECT ?, ?, COALESCE(MAX(numero), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ?, 1 FROM deliveries WHERE mesa = ? ON CONFLICT(id) DO NOTHING").bind(id, mesa, nombre, direccion, lat, lng, precision, new Date().toISOString(), user.userId, user.name, mesa).run();
  const saved = await db.prepare("SELECT * FROM deliveries WHERE id = ?").bind(id).first<Row>();
  if (!saved || saved.user_id !== user.userId) return json({ error: "No se pudo guardar. Vuelve a intentar." }, 409);
  return json({ folio: saved.mesa + "-" + saved.numero }, 201);
}

