import { env } from "cloudflare:workers";
import { getAppSession, hashToken, passwordMatches, readToken, sameOrigin, sessionCookie } from "../../../lib/app-session";
const json = (data: unknown, status = 200, cookie?: string) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store", ...(cookie ? { "Set-Cookie": cookie } : {}) } });
export async function GET(request: Request) {
  const user = await getAppSession(request);
  return json(user ? { authenticated: true, admin: user.role === "admin", role: user.role, name: user.name } : { authenticated: false, admin: false });
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Abre la aplicación directamente." }, 403);
  if (!env.DB) return json({ error: "Acceso no disponible. Intenta más tarde." }, 503);
  if (Number(request.headers.get("content-length")) > 4096) return json({ error: "Solicitud inválida." }, 413);
  let input: { role?: string; name?: string; password?: string };
  try { input = await request.json() as typeof input; } catch { return json({ error: "Solicitud inválida." }, 400); }
  if (!input || typeof input !== "object" || Array.isArray(input)) return json({ error: "Solicitud inválida." }, 400);
  let name: string;
  if (input.role === "admin") {
    if (!env.ADMIN_PASSWORD) return json({ error: "El acceso del administrador no está configurado." }, 503);
    const now = Date.now();
    const window = Math.floor(now / 900000);
    const key = await hashToken((request.headers.get("cf-connecting-ip") ?? "shared") + ":" + window);
    const attempts = await env.DB.prepare("SELECT count FROM login_attempts WHERE key = ?").bind(key).first<{ count: number }>();
    if (attempts && attempts.count >= 10) return json({ error: "Demasiados intentos. Espera 15 minutos antes de volver a intentar." }, 429);
    if (typeof input.password !== "string" || input.password.length > 256 || !await passwordMatches(input.password, env.ADMIN_PASSWORD)) {
      await env.DB.prepare("INSERT INTO login_attempts (key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1").bind(key, (window + 1) * 900000).run();
      return json({ error: "Contraseña incorrecta." }, 401);
    }
    await env.DB.prepare("DELETE FROM login_attempts WHERE key = ? OR expires_at < ?").bind(key, now).run();
    name = "Administrador";
  } else if (input.role === "operator") {
    name = typeof input.name === "string" ? input.name.trim().replace(/\s+/g, " ") : "";
    if (name.length < 2 || name.length > 100 || !/\p{L}/u.test(name) || /[\u0000-\u001f]/.test(name)) return json({ error: "Escribe tu nombre, de 2 a 100 caracteres." }, 400);
  } else return json({ error: "Elige administrador u operador." }, 400);
  const token = [...crypto.getRandomValues(new Uint8Array(32))].map(value => value.toString(16).padStart(2, "0")).join("");
  const tokenHash = await hashToken(token);
  await env.DB.prepare("DELETE FROM app_sessions WHERE expires_at < ?").bind(Date.now()).run();
  await env.DB.prepare("INSERT INTO app_sessions (token_hash, role, name, expires_at) VALUES (?, ?, ?, ?)").bind(tokenHash, input.role, name, Date.now() + 12 * 60 * 60 * 1000).run();
  const previous = readToken(request);
  if (previous) await env.DB.prepare("DELETE FROM app_sessions WHERE token_hash = ?").bind(await hashToken(previous)).run();
  return json({ authenticated: true, admin: input.role === "admin", role: input.role, name }, 200, sessionCookie + "=" + token + "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200");
}
export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Abre la aplicación directamente." }, 403);
  const token = readToken(request);
  if (token && env.DB) await env.DB.prepare("DELETE FROM app_sessions WHERE token_hash = ?").bind(await hashToken(token)).run();
  return json({ authenticated: false, admin: false }, 200, sessionCookie + "=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0");
}

