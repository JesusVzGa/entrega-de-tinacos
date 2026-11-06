"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { mesas, type Delivery } from "../lib/delivery";
import { INEReader } from "../components/ine-reader";
import { LoginScreen } from "../components/login-screen";
import type { SessionInfo } from "../lib/session-types";
type GPS = { lat: string; lng: string; precision: string };
const api = "/api/entregas";
const date = new Intl.DateTimeFormat("es-MX", { dateStyle: "short", timeStyle: "short", timeZone: "America/Mexico_City" });
async function compress(file: Blob, max = 1600, quality = .84) {
  const bitmap = await createImageBitmap(file);
  const ratio = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
  canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
  try {
    const context = canvas.getContext("2d");
    if (!context) throw Error("No se pudo procesar la foto.");
    context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Error("No se pudo procesar la foto.")), "image/jpeg", quality));
  } finally { bitmap.close(); }
}
const toDataURL = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob);
});
export default function Page() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/session", { cache: "no-store" }).then(async response => {
      if (!response.ok) throw Error();
      const value = await response.json() as SessionInfo;
      setSession(value.authenticated ? value : null);
    }).catch(() => setError("No se pudo comprobar la sesión. Recarga la página.")).finally(() => setLoading(false));
  }, []);
  async function logout() {
    const response = await fetch("/api/session", { method: "DELETE" });
    if (!response.ok) throw Error("No se pudo cerrar la sesión. Intenta de nuevo.");
    setSession(null);
  }
  if (loading) return <main><p role="status">Comprobando sesión…</p></main>;
  if (error) return <main><p className="bad" role="alert">{error}</p></main>;
  if (!session) return <LoginScreen onLogin={setSession} />;
  return <DeliveryApp session={session} onLogout={logout} />;
}
function DeliveryApp({ session, onLogout }: { session: SessionInfo; onLogout: () => Promise<void> }) {
  const admin = session.admin;
  const [records, setRecords] = useState<Delivery[] | null>(null);
  const [listError, setListError] = useState("");
  const [query, setQuery] = useState("");
  const [mesa, setMesa] = useState("");
  const [nombre, setNombre] = useState("");
  const [direccion, setDireccion] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [inePhoto, setINEPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState("");
  const [gps, setGPS] = useState<GPS | null>(null);
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reading, setReading] = useState(false);
  const [ineKey, setINEKey] = useState(0);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(false);
  const [exporting, setExporting] = useState("");
  const busy = useRef(false);
  const requestId = useRef("");
  const gpsGeneration = useRef(0);
  async function refresh() {
    setListError("");
    try {
      const response = await fetch(api, { cache: "no-store" });
      if (!response.ok) throw Error();
      setRecords(await response.json());
    } catch { setListError("No se pudo actualizar el historial."); }
  }
  useEffect(() => { if (admin) void refresh(); }, [admin]);
  useEffect(() => {
    if (!file) { setPreview(""); return; }
    const url = URL.createObjectURL(file); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  function locate() {
    const generation = ++gpsGeneration.current;
    setGPS(null); setLocating(false);
    if (!navigator.geolocation) { setError(true); setNotice("Este navegador no ofrece acceso a la ubicación."); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      if (generation !== gpsGeneration.current) return;
      setGPS({ lat: String(coords.latitude), lng: String(coords.longitude), precision: String(coords.accuracy) }); setLocating(false);
    }, failure => {
      if (generation !== gpsGeneration.current) return;
      setError(true); setNotice(failure.code === 1 ? "Permite el acceso a la ubicación y pulsa Reintentar ubicación." : "No se obtuvo la ubicación. Intenta de nuevo desde un lugar abierto."); setLocating(false);
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!gps || !file || !inePhoto || !mesa || !confirmed || busy.current || reading) return;
    busy.current = true; setSaving(true); setNotice("");
    try {
      if (!requestId.current) requestId.current = crypto.randomUUID();
      const photo = await compress(file);
      const ine = await compress(inePhoto, 2200, .94);
      const body = new FormData();
      body.set("foto", photo, "entrega.jpg"); body.set("ine", ine, "ine.jpg"); body.set("mesa", mesa);
      body.set("nombre", nombre.trim()); body.set("direccion", direccion.trim()); body.set("confirmado", "si");
      Object.entries(gps).forEach(([key, value]) => body.set(key, value));
      const response = await fetch(api, { method: "POST", body, headers: { "x-request-id": requestId.current } });
      const result = await response.json() as { folio: string; error?: string };
      if (!response.ok) throw Error(result.error ?? "No se pudo guardar. Verifica la conexión.");
      setError(false); setNotice("Entrega guardada · Folio " + result.folio);
      setNombre(""); setDireccion(""); setConfirmed(false); setFile(null); setINEPhoto(null); setGPS(null);
      gpsGeneration.current++; requestId.current = ""; setINEKey(value => value + 1);
      const form = document.getElementById("delivery-form") as HTMLFormElement | null; form?.reset();
      if (admin) void refresh();
    } catch (failure) {
      setError(true); setNotice(failure instanceof TypeError ? "Verifica tu conexión y vuelve a guardar. El reintento conserva el mismo registro para evitar duplicados." : failure instanceof Error ? failure.message : "No se pudo guardar.");
    } finally { busy.current = false; setSaving(false); }
  }
  async function exportExcel() {
    if (!records?.length || exporting) return;
    setListError(""); setExporting("Preparando Excel…");
    try {
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Entregas");
      sheet.columns = [
        { header: "Folio", key: "folio", width: 16 }, { header: "Mesa", key: "mesa", width: 12 },
        { header: "Operador", key: "operador", width: 25 }, { header: "Nombre", key: "nombre", width: 32 }, { header: "Dirección", key: "direccion", width: 45 },
        { header: "Fecha y hora (México)", key: "fecha", width: 25 }, { header: "Latitud", key: "lat", width: 16 },
        { header: "Longitud", key: "lng", width: 16 }, { header: "Precisión (m)", key: "precision", width: 16 },
        { header: "Mapa", key: "mapa", width: 20 }, { header: "Foto de entrega", key: "foto", width: 36 }, { header: "Foto de INE", key: "ine", width: 36 },
      ];
      sheet.views = [{ state: "frozen", ySplit: 1 }]; sheet.autoFilter = "A1:L1";
      sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF103B48" } };
      for (let index = 0; index < records.length; index++) {
        const record = records[index]; setExporting("Incluyendo foto " + (index + 1) + " de " + records.length + "…");
        const row = sheet.addRow({ ...record, fecha: date.format(new Date(record.fecha)), mapa: { text: "Ver ubicación", hyperlink: "https://www.google.com/maps?q=" + encodeURIComponent(record.lat + "," + record.lng) } });
        row.height = 130; row.alignment = { vertical: "top", wrapText: true };
        const photos = [{ kind: "entrega", col: 10 }, ...(record.tieneINE ? [{ kind: "ine", col: 11 }] : [])];
        if (!record.tieneINE) row.getCell(12).value = "No disponible (registro anterior)";
        for (const photo of photos) {
          const response = await fetch(api + "?foto=" + encodeURIComponent(record.folio) + "&tipo=" + photo.kind);
          if (!response.ok) throw Error("No se pudo descargar la foto de " + photo.kind + " del folio " + record.folio + ". Vuelve a intentar la exportación.");
          const image = await compress(await response.blob(), 440, .8);
          const id = workbook.addImage({ base64: await toDataURL(image), extension: "jpeg" });
          const bitmap = await createImageBitmap(image);
          const scale = Math.min(230 / bitmap.width, 160 / bitmap.height);
          const ext = { width: bitmap.width * scale, height: bitmap.height * scale };
          bitmap.close();
          sheet.addImage(id, { tl: { col: photo.col, row: row.number - 1 }, ext, editAs: "oneCell" });
        }
      }
      setExporting("Generando archivo…");
      const buffer = await workbook.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const link = document.createElement("a"); link.href = url; link.download = "entregas-tinacos.xlsx"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (failure) { setListError(failure instanceof Error ? failure.message : "No se pudo exportar el Excel. Vuelve a intentar."); }
    finally { setExporting(""); }
  }
  const filtered = records?.filter(r => r.folio.includes(query.trim().toUpperCase()));
  return <main>
    <header className="hero">
      <div className="eyebrow">OPERACIÓN EN CAMPO</div>
      <h1>Entrega de tinacos</h1>
      <p>Selecciona tu mesa y registra cada entrega con sus datos y evidencia.</p>
      <div className="session-bar"><span>{admin ? "Administrador" : "Operador"}: {session.name}</span><button type="button" className="secondary" disabled={saving || reading || !!exporting} onClick={() => { void onLogout().catch(failure => { setError(true); setNotice(failure.message); }); }}>Cerrar sesión</button></div>
      {admin && <div className="progress-label"><strong>{records?.length.toLocaleString("es-MX") ?? "—"}</strong> tinacos entregados</div>}
    </header>
    <div className={admin ? "grid" : "grid operator"}>
      <section className="panel">
        <h2>Nueva entrega</h2>
        <label htmlFor="mesa">Primero elige tu mesa</label>
        <select id="mesa" value={mesa} onChange={e => { setMesa(e.target.value); requestId.current = ""; }} disabled={saving || reading}>
          <option value="">Selecciona una mesa</option>
          {mesas.map(m => <option key={m} value={m}>Mesa {m}</option>)}
        </select>
        {!mesa ? <p className="empty">Elige la mesa que te asignaron para comenzar.</p> : <>
          <p className="folio-info">Mesa {mesa} · El folio se asigna al guardar.<small>Consecutivo independiente: {mesa}-1, {mesa}-2, {mesa}-3…</small></p>
          <form id="delivery-form" onSubmit={submit}>
            <INEReader key={ineKey} disabled={saving} onPhoto={setINEPhoto} onBusy={value => { setReading(value); if (value) setConfirmed(false); }} onResult={data => {
              if (data.nombre) setNombre(data.nombre);
              if (data.direccion) setDireccion(data.direccion);
              setConfirmed(false);
            }} />
            <fieldset disabled={saving || reading}>
              <label htmlFor="nombre">Nombre completo</label>
              <input id="nombre" value={nombre} maxLength={160} required onChange={e => { setNombre(e.target.value); setConfirmed(false); }} autoComplete="off" />
              <label htmlFor="direccion">Dirección</label>
              <textarea id="direccion" value={direccion} maxLength={500} rows={3} required onChange={e => { setDireccion(e.target.value); setConfirmed(false); }} autoComplete="off" />
              <label className="checkbox"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} required />Revisé el nombre y la dirección y son correctos.</label>
              <label htmlFor="photo">2. Foto de evidencia de la entrega</label>
              <input id="photo" type="file" accept="image/*" capture="environment" required onChange={e => {
                const next = e.target.files?.[0] ?? null; setFile(next);
                if (next) { setNotice(""); locate(); } else { gpsGeneration.current++; setGPS(null); setLocating(false); }
              }} />
              {preview && <img className="preview" src={preview} alt="Vista previa de la evidencia" />}
              <label>3. Ubicación de la entrega</label>
              <small>{locating ? "Obteniendo ubicación automáticamente…" : gps ? "Ubicación capturada · precisión ±" + Math.ceil(Number(gps.precision)) + " m" : "Se captura automáticamente al tomar o seleccionar la foto de evidencia. Permite el acceso cuando lo solicite tu navegador."}</small>
              {file && !locating && !gps && <button type="button" className="secondary" onClick={locate}>Reintentar ubicación</button>}
              <button className="primary" disabled={!gps || !file || !inePhoto || !nombre.trim() || !direccion.trim() || !confirmed || locating}>{saving ? "Guardando…" : "Guardar entrega"}</button>
            </fieldset>
          </form>
        </>}
        {notice && <p role="status" className={error ? "bad" : "good"}>{notice}</p>}
      </section>
      {admin && <section className="panel">
        <div className="eyebrow admin-tag">ADMINISTRADOR</div><h2>Historial</h2>
        <label htmlFor="buscar">Buscar por folio</label>
        <input id="buscar" placeholder="Ej. II-1" value={query} onChange={e => setQuery(e.target.value)} />
        <div className="actions">
          <button className="secondary" onClick={refresh} disabled={!!exporting}>Actualizar</button>
          <button className="secondary" onClick={exportExcel} disabled={!records?.length || !!exporting}>Exportar Excel con fotos</button>
        </div>
        <small>Exporta todas las entregas con las fotos de entrega e INE, el operador, los datos y el enlace al mapa.</small>
        {exporting && <p className="empty" role="status">{exporting}</p>}
        {listError && <p role="status" className="bad">{listError}</p>}
        {filtered?.length === 0 && <p className="empty">{query.trim() ? "No hay coincidencias." : "Aquí aparecerán las entregas guardadas."}</p>}
        {!records && !listError && <p className="empty">Cargando historial…</p>}
        <ul>{filtered?.map(r => <li key={r.folio}>
          <strong>{r.folio}</strong><small>{date.format(new Date(r.fecha))}</small>
          {r.operador && <small>Registró: {r.operador}</small>}
          {r.nombre && <p>{r.nombre}<small>{r.direccion}</small></p>}
          <div className="links">
            <a href={api + "?foto=" + encodeURIComponent(r.folio)} target="_blank" rel="noreferrer">Ver entrega</a>
            {r.tieneINE ? <a href={api + "?foto=" + encodeURIComponent(r.folio) + "&tipo=ine"} target="_blank" rel="noreferrer">Ver INE</a> : <small>Sin foto de INE (registro anterior)</small>}
            <a href={"https://www.google.com/maps?q=" + encodeURIComponent(r.lat + "," + r.lng)} target="_blank" rel="noreferrer">Ver mapa</a>
          </div>
        </li>)}</ul>
      </section>}
    </div>
  </main>;
}

