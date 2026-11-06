import { env } from "cloudflare:workers";
import { getAppSession, sameOrigin } from "../../../lib/app-session";
import { isAdmin } from "../../../lib/admin";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
export async function POST(request: Request) {
  const user = await getAppSession(request);
  if (!user) return json({ error: "Inicia sesión." }, 401);
  if (!isAdmin(user)) return json({ error: "Solo el administrador puede restablecer los registros." }, 403);
  if (!sameOrigin(request)) return json({ error: "Abre la aplicación directamente." }, 403);
  const db = env.DB, bucket = env.BUCKET;
  if (!db || !bucket) return json({ error: "Almacenamiento no disponible." }, 503);
  if (Number(request.headers.get("content-length")) > 2048) return json({ error: "Solicitud inválida." }, 413);
  let input: { confirmacion?: string; job?: string };
  try { input = await request.json() as typeof input; } catch { return json({ error: "Solicitud inválida." }, 400); }
  if (!input || input.confirmacion !== "RESTABLECER") return json({ error: "Confirma escribiendo RESTABLECER." }, 400);
  if (input.job !== undefined && (typeof input.job !== "string" || !/^[0-9a-f-]{36}$/.test(input.job))) return json({ error: "Solicitud inválida." }, 400);
  if (!input.job) {
    // D1 batch is atomic: advancing the generation rejects captures already in flight.
    await db.batch([
      db.prepare("UPDATE delivery_state SET resetting = 1, generation = generation + 1, job = ? WHERE id = 1 AND resetting = 0").bind(crypto.randomUUID()),
      db.prepare("DELETE FROM deliveries"),
    ]);
    const state = await db.prepare("SELECT job FROM delivery_state WHERE id = 1").first<{ job: string }>();
    return json({ terminado: false, job: state!.job });
  }
  const state = await db.prepare("SELECT job, resetting FROM delivery_state WHERE id = 1").first<{ job: string; resetting: number }>();
  if (!state || state.job !== input.job) return json({ error: "La operación ya cambió. Inicia de nuevo." }, 409);
  if (!state.resetting) return json({ terminado: true });
  try {
    // Bounded requests can be retried after interruption without loading all photos.
    for (const prefix of ["evidencias/", "ine/", "entregas/"]) {
      const listed = await bucket.list({ prefix, limit: 500 });
      if (listed.objects.length) {
        await bucket.delete(listed.objects.map(object => object.key));
        return json({ terminado: false, job: input.job });
      }
    }
    await db.prepare("UPDATE delivery_state SET resetting = 0 WHERE id = 1 AND job = ?").bind(input.job).run();
    return json({ terminado: true });
  } catch {
    return json({ error: "No se completó el borrado de fotos. Usa el botón para reanudar; los registros siguen bloqueados." }, 503);
  }
}
