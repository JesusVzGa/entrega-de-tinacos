import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";
import { mesas } from "../lib/delivery.ts";
const sql = new DatabaseSync(":memory:");
for (const file of readdirSync("drizzle").filter(name => name.endsWith(".sql")).sort()) sql.exec(readFileSync("drizzle/" + file, "utf8"));
const db = { async batch(statements) {
  sql.exec("BEGIN");
  try { const result = []; for (const statement of statements) result.push(await statement.run()); sql.exec("COMMIT"); return result; }
  catch (error) { sql.exec("ROLLBACK"); throw error; }
}, prepare(query) {
  const statement = sql.prepare(query);
  const result = args => ({
    async first() { return statement.get(...args) ?? null; },
    async all() { return { results: statement.all(...args) }; },
    async run() { return statement.run(...args); },
  });
  return { ...result([]), bind(...args) { return result(args); } };
} };
const objects = new Map([["entregas/TIN-001", { bytes: new Uint8Array([255,216,255]), uploaded: new Date("2026-11-04"), customMetadata: { lat:"19",lng:"-96",precision:"5" } }]]);
let failDelete = false; let duringUpload = null;
const bucket = {
  async put(key, bytes) { if (duringUpload) { const action=duringUpload; duringUpload=null; await action(); } if (objects.has(key)) return null; objects.set(key, { bytes }); return {}; },
  async get(key) { const item = objects.get(key); return item ? { body: item.bytes } : null; },
  async list({prefix="", limit=1000} = {}) { const all=[...objects].filter(([key])=>key.startsWith(prefix)); return { objects: all.slice(0,limit).map(([key,item])=>({ key, ...item })), truncated: all.length>limit }; },
  async delete(keys) { if(failDelete) throw Error("temporary test failure"); for(const key of Array.isArray(keys)?keys:[keys]) objects.delete(key); },
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
const reporting = await moduleFrom("lib/delivery-report.ts", { mesas });
const deliveries = await moduleFrom("app/api/entregas/route.ts", { env, ...sessionTools, isAdmin, mesas, ...reporting });
const reset = await moduleFrom("app/api/restablecer/route.ts", { env, ...sessionTools, isAdmin });
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
const history = await (await deliveries.GET(request("/api/entregas", admin))).json();
const rows = history.items;
assert.equal(history.total, 6);
assert.equal(rows.length, 6); assert(rows.some(r => r.folio === "TIN-001"));
assert(!rows.some(r => "user_id" in r || "id" in r));
assert(rows.find(r => r.folio === "II-1").tieneINE);
assert.equal((await deliveries.GET(request("/api/entregas?foto=II-1", admin))).status, 200);
assert.equal((await deliveries.GET(request("/api/entregas?foto=II-1&tipo=ine", admin))).status, 200);
assert.equal((await deliveries.GET(request("/api/entregas?foto=TIN-001&tipo=ine", admin))).status, 404);
assert.equal((await deliveries.GET(request("/api/entregas?foto=II-1&tipo=invalid", admin))).status, 400);
// Exercise the actual paginated routes with 2,500 synthetic records in memory.
const seed = sql.prepare("INSERT INTO deliveries (id,mesa,numero,nombre,direccion,lat,lng,precision,fecha,user_id,operador,tiene_ine) SELECT ?,?,COALESCE(MAX(numero),0)+1,'PERSONA FICTICIA','DOMICILIO FICTICIO',19,-96,5,'2026-11-05T00:00:00.000Z','seed','PRUEBA',? FROM deliveries WHERE mesa=?");
sql.exec("BEGIN");
for (let i=0;i<2494;i++) { const mesa=mesas[i%16]; seed.run(crypto.randomUUID(),mesa,i%2,mesa); }
sql.exec("COMMIT");
const summary = await (await deliveries.GET(request("/api/entregas?resumen=1",admin))).json();
assert.equal(summary.total,2500); assert.equal(summary.porMesa.length,16); assert.equal(summary.mesasActivas,16);
assert.equal(summary.porMesa.reduce((n,r)=>n+r.total,summary.sinMesa),2500);
assert.equal(summary.conINE+summary.sinINE,2500);
const seen=new Set();
for(let page=1;page<=100;page++){
  const result=await (await deliveries.GET(request("/api/entregas?pagina="+page,admin))).json();
  assert.equal(result.items.length,25); assert.equal(result.total,2500); assert.equal(result.paginas,100);
  for(const row of result.items){assert(!seen.has(row.folio));seen.add(row.folio);}
}
assert.equal(seen.size,2500); assert(seen.has("TIN-001"));
const forMesa = await (await deliveries.GET(request("/api/entregas?mesa=II&limite=150",admin))).json();
assert(forMesa.items.every(row=>row.mesa==="II")); assert.equal(forMesa.total,summary.porMesa.find(row=>row.mesa==="II").total);
const export1 = await (await deliveries.GET(request("/api/entregas?mesa=II&exportar=1&limite=150",admin))).json();
assert.equal(export1.items.length,150);assert.equal(export1.items[0].folio,"II-1");
await save("II");
const exportAgain=await (await deliveries.GET(request("/api/entregas?mesa=II&exportar=1&limite=150",admin))).json();
assert.deepEqual(exportAgain.items.map(row=>row.folio),export1.items.map(row=>row.folio));
const export2=await (await deliveries.GET(request("/api/entregas?mesa=II&exportar=1&limite=150&pagina=2",admin))).json();
assert(export2.items.length<=150);assert(!export2.items.some(row=>export1.items.some(first=>first.folio===row.folio)));
const legacy=await (await deliveries.GET(request("/api/entregas?mesa=sin-mesa",admin))).json();assert.equal(legacy.total,1);assert.equal(legacy.items[0].folio,"TIN-001");
const empty=await (await deliveries.GET(request("/api/entregas?mesa=II&q=NO-SUCH",admin))).json();assert.equal(empty.total,0);assert.equal(empty.pagina,1);assert.equal(empty.paginas,1);
const search=await (await deliveries.GET(request("/api/entregas?mesa=II&q=II-1",admin))).json();assert(search.items.every(row=>row.mesa==="II"&&row.folio.includes("II-1")));
for(const params of ["mesa=XVII","pagina=0","limite=151","exportar=1","mesa=II&exportar=1&q=II-1"]){assert.equal((await deliveries.GET(request("/api/entregas?"+params,admin))).status,400);}
assert.equal((await deliveries.GET(request("/api/entregas?resumen=1",operator))).status,403);
const ExcelJS=(await import("exceljs")).default; const {fillSummaryWorkbook}=await import("../lib/workbook-report.ts");
const workbook=new ExcelJS.Workbook();fillSummaryWorkbook(workbook,summary);const loaded=new ExcelJS.Workbook();await loaded.xlsx.load(await workbook.xlsx.writeBuffer());
assert.equal(loaded.worksheets.length,1);const totals=loaded.getWorksheet("Totales por mesa");assert.equal(totals.rowCount,18);assert.equal(totals.columnCount,2);assert.equal(totals.getCell("B18").value,2499);assert.equal(totals.getCell("A17").value,"Mesa XVI");assert.equal(totals.getImages().length,0);
console.log("PASS: 2,500 synthetic records, 100 pages, per-mesa filtering and search, totals of all 16 mesas, legacy records, bounded exports stable across new arrivals and summary Excel round-trip.");
async function resetRequest(who=admin, input={confirmacion:"RESTABLECER"}, extra={}) {
  return reset.POST(new Request(origin+"/api/restablecer",{method:"POST",headers:headers(who,{"Content-Type":"application/json",...extra}),body:JSON.stringify(input)}));
}
assert.equal((await resetRequest("")).status,401);
assert.equal((await resetRequest(operator)).status,403);
assert.equal((await resetRequest(admin,{},{})).status,400);
assert.equal((await resetRequest(admin,{confirmacion:"RESTABLECER"},{origin:"https://foreign.test"})).status,403);
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM deliveries").get().n,2500);
// Populate >5,000 mock photos to exercise bounded deletion and resumability.
for(let i=0;i<2500;i++){objects.set("evidencias/mock-"+i,{bytes:new Uint8Array([255])});objects.set("ine/mock-"+i,{bytes:new Uint8Array([255])});}
objects.set("unrelated/keep",{bytes:new Uint8Array([1])});
const started=await (await resetRequest()).json();
assert.equal(started.terminado,false);assert(started.job);
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM deliveries").get().n,0);
assert.equal((await save("I")).status,503);
assert.equal((await resetRequest(admin,{confirmacion:"RESTABLECER",job:crypto.randomUUID()})).status,409);
failDelete=true;assert.equal((await resetRequest(admin,{confirmacion:"RESTABLECER",job:started.job})).status,503);failDelete=false;
const resumed=await (await resetRequest()).json();assert.equal(resumed.job,started.job);
let passes=0;
for(;;){ const result=await (await resetRequest(admin,{confirmacion:"RESTABLECER",job:started.job})).json();passes++;if(result.terminado)break;assert(passes<30); }
assert(passes>10);assert.equal(objects.size,1);assert(objects.has("unrelated/keep"));
assert.equal((await (await deliveries.GET(request("/api/entregas?resumen=1",admin))).json()).total,0);
assert.equal((await (await save("II")).json()).folio,"II-1");
// A reset that begins while a capture is uploading must prevent its stale insert.
let interruptedJob;
duringUpload=async()=>{interruptedJob=(await (await resetRequest()).json()).job};
assert.equal((await save("I")).status,409);
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM deliveries").get().n,0);
for(;;){const result=await (await resetRequest(admin,{confirmacion:"RESTABLECER",job:interruptedJob})).json();if(result.terminado)break;}
assert.equal((await (await save("XVI")).json()).folio,"XVI-1");
console.log("PASS: admin-only reset, explicit confirmation, same-origin, >5,000 photos deleted in bounded batches, retry after failure, capture lock, stale upload rejection, preserved unrelated objects and folios restart at 1. Production data untouched.");
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

