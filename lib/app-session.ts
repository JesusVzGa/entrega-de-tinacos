import { env } from "cloudflare:workers";
export const sessionCookie = "__Host-tinacos_session";
export type AppSession = { userId: string; role: "admin" | "operator"; name: string };
export async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}
export function readToken(request: Request) {
  const value = request.headers.get("cookie")?.split(";").map(v => v.trim()).find(v => v.startsWith(sessionCookie + "="))?.slice(sessionCookie.length + 1);
  return value && /^[0-9a-f]{64}$/.test(value) ? value : null;
}
export async function getAppSession(request: Request): Promise<AppSession | null> {
  const token = readToken(request);
  if (!token || !env.DB) return null;
  const tokenHash = await hashToken(token);
  const row = await env.DB.prepare("SELECT role, name FROM app_sessions WHERE token_hash = ? AND expires_at > ?").bind(tokenHash, Date.now()).first<{ role: string; name: string }>();
  if (!row || (row.role !== "admin" && row.role !== "operator")) return null;
  return { userId: tokenHash, role: row.role, name: row.name };
}
export function sameOrigin(request: Request) {
  return request.headers.get("sec-fetch-site") === "same-origin" && request.headers.get("origin") === new URL(request.url).origin;
}
export async function passwordMatches(value: string, secret: string) {
  const [left, right] = await Promise.all([hashToken(value), hashToken(secret)]);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}
