import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";
import { mesas } from "../lib/delivery.ts";
const sql = new DatabaseSync(":memory:");
for (const file of readdirSync("drizzle").filter(name => name.endsWith(".sql")).sort()) sql.exec(readFileSync("drizzle/" + file, "utf8"));
const db = { prepare(query) {
  const statement = sql.prepare(query);
  const result = args => ({
    async first() { return statement.get(...args) ?? null; },
    async all() { return { results: statement.all(...args) }; },
    async run() { return statement.run(...args); },
  });
  return { ...result([]), bind(...args) { return result(args); } };
} };
const objects = new Map();
const bucket = {
  async put(key, bytes) { if (objects.has(key)) return null; objects.set(key, { bytes }); return {}; },
  async get(key) { const item = objects.get(key); return item ? { body: item.bytes } : null; },
  async list() { return { objects: [{ key: "entregas/TIN-001", uploaded: new Date("2026-11-04"), customMetadata: { lat: "19", lng: "-96", precision: "5" } }], truncated: false }; },
};
const env = { DB: db, BUCKET: bucket, ADMIN_PASSWORD: "test-only-secret" };
async function moduleFrom(path, bindings) {
  const slot = "__test_" + Math.random().toString(36).slice(2);
  globalThis[slot] = bindings;
  const source = "const {" + Object.keys(bindings).join(",") + "}=globalThis." + slot + ";\n" + readFileSync(path, "utf8").replace(/^import .*;\r?$/gm, "");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import("data:text/javascript;base64," + Buffer.from(compiled).toString("base64"));
}
const sessionTools = await moduleFrom("lib/app-session.ts", { env });
const { isAdmin } = await moduleFrom("lib/admin.ts", {});
const session = await moduleFrom("app/api/session/route.ts", { env, ...sessionTools });
const deliveries = await moduleFrom("app/api/entregas/route.ts", { env, ...sessionTools, isAdmin, mesas });
const origin = "https://site.test";
const request = (path = "/api/entregas", cookie = "") => new Request(origin + path, { headers: { cookie } });
const headers = (cookie = "", extra = {}) => ({ cookie, origin, "sec-fetch-site": "same-origin", ...extra });
async function login(input, extra = {}) {
  return session.POST(new Request(origin + "/api/session", { method: "POST", headers: headers("", { "Content-Type": "application/json", ...extra }), body: JSON.stringify(input) }));
}
const cookie = response => response.headers.get("set-cookie").split(";")[0];
assert.equal((await session.GET(request("/api/session"))).status, 200);
assert.equal((await (await session.GET(request("/api/session"))).json()).authenticated, false);
assert.equal((await login({ role: "admin", password: "wrong" })).status, 401);
assert.equal((await login({ role: "operator", name: "" })).status, 400);
assert.equal((await login({ role: "owner" })).status, 400);
assert.equal((await login({ role: "operator", name: "Prueba" }, { origin: "https://foreign.test" })).status, 403);
const adminResponse = await login({ role: "admin", password: env.ADMIN_PASSWORD });
assert.equal(adminResponse.status, 200);
const admin = cookie(adminResponse);
for (const part of ["HttpOnly", "Secure", "SameSite=Strict"]) assert(adminResponse.headers.get("set-cookie").includes(part));
const operatorResponse = await login({ role: "operator", name: "  Operador   de prueba  ", admin: true });
const operator = cookie(operatorResponse);
const info = await operatorResponse.json();
assert.equal(info.name, "Operador de prueba"); assert.equal(info.admin, false);
assert.equal((await (await session.GET(request("/api/session", admin))).json()).admin, true);
assert.equal((await (await session.GET(request("/api/session", sessionTools.sessionCookie + "=" + "a".repeat(64)))).json()).authenticated, false);
assert.equal((await deliveries.GET(request())).status, 401);
for (const path of ["/api/entregas", "/api/entregas?foto=TIN-001", "/api/entregas?foto=II-1&tipo=ine"]) assert.equal((await deliveries.GET(request(path, operator))).status, 403);
async function save(mesa, id = crypto.randomUUID(), who = operator, includeINE = true, confirmed = "si") {
  const form = new FormData();
  for (const [key, value] of Object.entries({ mesa, nombre: "PERSONA DE PRUEBA", direccion: "DOMICILIO DE PRUEBA", operador: "FORGED", confirmado: confirmed, lat: "19.1", lng: "-96.1", precision: "5" })) form.set(key, value);
  const image = new Blob([new Uint8Array([255,216,255,0])], { type: "image/jpeg" });
  form.set("foto", image, "foto.jpg"); if (includeINE) form.set("ine", image, "ine.jpg");
  return deliveries.POST(new Request(origin + "/api/entregas", { method: "POST", body: form, headers: headers(who, { "x-request-id": id }) }));
}
assert.equal((await save("I", crypto.randomUUID(), "")).status, 401);
assert.equal((await save("I", crypto.randomUUID(), operator, false)).status, 400);
assert.equal((await save("XVII")).status, 400);
assert.equal((await save("I", crypto.randomUUID(), operator, true, "no")).status, 400);
const id = crypto.randomUUID();
assert.equal((await (await save("II", id)).json()).folio, "II-1");
assert.equal((await (await save("II", id)).json()).folio, "II-1");
assert(objects.has("evidencias/" + id)); assert(objects.has("ine/" + id));
assert.equal(sql.prepare("SELECT operador FROM deliveries WHERE id=?").get(id).operador, info.name);
const concurrent = await Promise.all([save("II"), save("II"), save("I"), save("XVI")]);
assert.deepEqual(await Promise.all(concurrent.map(async r => (await r.json()).folio)), ["II-2", "II-3", "I-1", "XVI-1"]);
const other = cookie(await login({ role: "operator", name: "Otra persona" }));
assert.equal((await save("II", id, other)).status, 409);
const rows = await (await deliveries.GET(request("/api/entregas", admin))).json();
assert.equal(rows.length, 6); assert(rows.some(r => r.folio === "TIN-001"));
assert(!rows.some(r => "user_id" in r || "id" in r));
assert(rows.find(r => r.folio === "II-1").tieneINE);
assert.equal((await deliveries.GET(request("/api/entregas?foto=II-1", admin))).status, 200);
assert.equal((await deliveries.GET(request("/api/entregas?foto=II-1&tipo=ine", admin))).status, 200);
assert.equal((await deliveries.GET(request("/api/entregas?foto=TIN-001&tipo=ine", admin))).status, 404);
assert.equal((await deliveries.GET(request("/api/entregas?foto=II-1&tipo=invalid", admin))).status, 400);
const logout = () => session.DELETE(new Request(origin + "/api/session", { method: "DELETE", headers: headers(operator) }));
assert.equal((await logout()).status, 200);
assert.equal((await (await session.GET(request("/api/session", operator))).json()).authenticated, false);
assert.equal((await save("I", crypto.randomUUID(), operator)).status, 401);
sql.prepare("UPDATE app_sessions SET expires_at=0").run();
assert.equal((await (await session.GET(request("/api/session", admin))).json()).authenticated, false);
for (let i = 0; i < 10; i++) assert.equal((await login({ role: "admin", password: "wrong" }, { "cf-connecting-ip": "rate-test" })).status, 401);
assert.equal((await login({ role: "admin", password: env.ADMIN_PASSWORD }, { "cf-connecting-ip": "rate-test" })).status, 429);
console.log("PASS: administrator password, operator name-only access, server sessions, cookie flags, forged/expired sessions, logout, rate limit, role authorization, both private photos, legacy records, operator attribution, independent sequences and safe retries.");
sql.close();

