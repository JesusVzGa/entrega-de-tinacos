"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { mesas } from "../lib/delivery";
import type { HistoryPage, DeliverySummary } from "../lib/delivery-report";
import { fillSummaryWorkbook, reportDate, styleHeader } from "../lib/workbook-report";
import { ResetDeliveries } from "./reset-deliveries";
import type { Workbook } from "exceljs";
const api = "/api/entregas";
const exportSize = 150;
async function getJSON<T>(params: URLSearchParams, signal?: AbortSignal): Promise<T> {
  const response = await fetch(api + "?" + params, { cache: "no-store", signal });
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw Error(result.error ?? "No se pudo consultar la información.");
  return result;
}
async function download(workbook: Workbook, filename: string) {
  const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
async function thumbnail(blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    const ratio = Math.min(1, 360 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(bitmap.width * ratio)); canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const context = canvas.getContext("2d"); if (!context) throw Error("No se pudo procesar una foto.");
    context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return { base64: canvas.toDataURL("image/jpeg", .78), width: canvas.width, height: canvas.height };
  } finally { bitmap.close(); }
}
export function AdminHistory({ revision, onTotal, onBusy }: { revision: number; onTotal: (value: number | null) => void; onBusy: (value: boolean) => void }) {
  const [summary, setSummary] = useState<DeliverySummary | null>(null);
  const [summaryError, setSummaryError] = useState("");
  const [history, setHistory] = useState<HistoryPage | null>(null);
  const [mesa, setMesa] = useState("");
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [exporting, setExporting] = useState("");
  const [resetting, setResetting] = useState(false);
  const [part, setPart] = useState(1);
  const exportActive = useRef(false);
  useEffect(() => {
    const controller = new AbortController(); setSummaryError("");
    getJSON<DeliverySummary>(new URLSearchParams({ resumen: "1" }), controller.signal).then(data => { setSummary(data); onTotal(data.total); }).catch(error => {
      if (!controller.signal.aborted) { setSummaryError(error.message); onTotal(null); }
    });
    return () => controller.abort();
  }, [revision, refresh, onTotal]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setListError("");
    getJSON<HistoryPage>(new URLSearchParams({ mesa, q, pagina: String(page), limite: "25" }), controller.signal).then(data => {
      setHistory(data); if (data.pagina !== page) setPage(data.pagina);
    }).catch(error => { if (!controller.signal.aborted) { setListError(error.message); setHistory(null); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [mesa, q, page, revision, refresh]);
  const selectedCount = mesa === "sin-mesa" ? summary?.sinMesa ?? 0 : summary?.porMesa.find(row => row.mesa === mesa)?.total ?? 0;
  const parts = Math.max(1, Math.ceil(selectedCount / exportSize));
  const selectedPart = Math.min(part, parts);
  const mesaLabel = mesa === "sin-mesa" ? "Anteriores sin mesa" : "Mesa " + mesa;
  async function runExport(action: () => Promise<void>) {
    if (exportActive.current) return;
    exportActive.current = true; onBusy(true); setListError("");
    try { await action(); } catch (error) { setListError(error instanceof Error ? error.message : "No se pudo descargar el archivo."); }
    finally { exportActive.current = false; setExporting(""); onBusy(false); }
  }
  function exportSummary() {
    if (!summary) return;
    void runExport(async () => {
      setExporting("Preparando resumen de todas las mesas…");
      const fresh = await getJSON<DeliverySummary>(new URLSearchParams({ resumen: "1" }));
      setSummary(fresh); onTotal(fresh.total);
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook(); fillSummaryWorkbook(workbook, fresh);
      await download(workbook, "resumen-todas-las-mesas.xlsx");
    });
  }
  function exportMesa() {
    if (!mesa || !selectedCount) return;
    void runExport(async () => {
      setExporting("Consultando " + mesaLabel + "…");
      // Export by ascending folio: new deliveries are appended, so downloading
      // a later part never shifts previously downloaded records.
      const data = await getJSON<HistoryPage>(new URLSearchParams({ mesa, pagina: String(selectedPart), limite: String(exportSize), exportar: "1" }));
      if (!data.items.length) throw Error("La mesa no tiene entregas para exportar.");
      const ExcelJS = (await import("exceljs")).default; const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet(mesa === "sin-mesa" ? "Anteriores" : "Mesa " + mesa);
      sheet.columns = [
        { header: "Folio", key: "folio", width: 16 }, { header: "Mesa", key: "mesa", width: 16 },
        { header: "Operador", key: "operador", width: 25 }, { header: "Nombre", key: "nombre", width: 32 }, { header: "Dirección", key: "direccion", width: 45 },
        { header: "Fecha y hora (México)", key: "fecha", width: 25 }, { header: "Latitud", key: "lat", width: 16 },
        { header: "Longitud", key: "lng", width: 16 }, { header: "Precisión (m)", key: "precision", width: 16 },
        { header: "Mapa", key: "mapa", width: 20 }, { header: "Foto de entrega", key: "foto", width: 36 }, { header: "Foto de INE", key: "ine", width: 36 },
      ];
      styleHeader(sheet); sheet.autoFilter = "A1:L1";
      for (let i = 0; i < data.items.length; i++) {
        const record = data.items[i]; setExporting("Foto " + (i + 1) + " de " + data.items.length + " · " + mesaLabel);
        const row = sheet.addRow({ ...record, mesa: record.mesa ?? "Sin mesa", fecha: reportDate(record.fecha), mapa: { text: "Ver ubicación", hyperlink: "https://www.google.com/maps?q=" + encodeURIComponent(record.lat + "," + record.lng) } });
        row.height = 130; row.alignment = { vertical: "top", wrapText: true };
        if (!record.tieneINE) row.getCell(12).value = "No disponible (registro anterior)";
        for (const photo of [{ tipo: "entrega", col: 10 }, ...(record.tieneINE ? [{ tipo: "ine", col: 11 }] : [])]) {
          const response = await fetch(api + "?" + new URLSearchParams({ foto: record.folio, tipo: photo.tipo }));
          if (!response.ok) throw Error("No se pudo descargar la foto de " + photo.tipo + " del folio " + record.folio + ". Vuelve a intentar.");
          const image = await thumbnail(await response.blob());
          const id = workbook.addImage({ base64: image.base64, extension: "jpeg" });
          const scale = Math.min(230 / image.width, 160 / image.height);
          sheet.addImage(id, { tl: { col: photo.col, row: row.number - 1 }, ext: { width: image.width * scale, height: image.height * scale }, editAs: "oneCell" });
        }
      }
      setExporting("Generando Excel…");
      await download(workbook, "entregas-" + (mesa === "sin-mesa" ? "anteriores" : "mesa-" + mesa) + "-archivo-" + data.pagina + ".xlsx");
    });
  }
  function search(event: FormEvent) { event.preventDefault(); setPage(1); setQ(draft.trim().toUpperCase()); }
  return <section className="panel">
    <div className="eyebrow admin-tag">ADMINISTRADOR</div><h2>Historial y resumen</h2>
    {summary && <>
      <div className="summary-cards"><div><strong>{summary.total.toLocaleString("es-MX")}</strong><small>Entregas totales</small></div><div><strong>{summary.mesasActivas} / 16</strong><small>Mesas con entregas</small></div></div>
      <details className="mesa-totals"><summary>Ver totales de todas las mesas</summary><table><thead><tr><th>Mesa</th><th>Entregados</th></tr></thead><tbody>
        {summary.porMesa.map(row => <tr key={row.mesa}><td>Mesa {row.mesa}</td><td>{row.total}</td></tr>)}
        <tr><th>Total general</th><th>{summary.porMesa.reduce((sum, row) => sum + row.total, 0)}</th></tr>
      </tbody></table></details>
    </>}
    {summaryError && <p role="alert" className="bad">{summaryError}</p>}
    <div className="actions"><button className="secondary" disabled={!summary || (!!exporting || resetting)} onClick={exportSummary}>Descargar resumen de todas las mesas</button><button className="secondary" disabled={!!exporting || loading} onClick={() => setRefresh(value => value + 1)}>Actualizar</button></div>
    <small>El resumen descarga los totales de las 16 mesas y el total general, sin cargar fotografías.</small>
    <label htmlFor="history-mesa">Filtrar historial por mesa</label>
    <select id="history-mesa" value={mesa} disabled={!!exporting} onChange={event => { setMesa(event.target.value); setPage(1); setPart(1); }}>
      <option value="">Todas las mesas</option>{mesas.map(value => <option key={value} value={value}>Mesa {value}</option>)}
    </select>
    <form onSubmit={search}><label htmlFor="buscar">Buscar por folio</label><input id="buscar" placeholder="Ej. II-1" value={draft} maxLength={40} disabled={!!exporting} onChange={event => setDraft(event.target.value)} /><div className="actions"><button className="secondary" disabled={!!exporting}>Buscar</button></div></form>
    <div className="export-box"><strong>Excel con fotos por mesa</strong>
      {!mesa ? <small>Selecciona una mesa en el filtro para descargar sus entregas con fotos.</small> : <>
        <small>{mesaLabel}: {selectedCount} entregas. Incluye toda la mesa, independientemente de la búsqueda por folio. Máximo 150 entregas por archivo.</small>
        {parts > 1 && <><label htmlFor="export-part">Archivo de la mesa</label><select id="export-part" value={selectedPart} disabled={!!exporting} onChange={event => setPart(Number(event.target.value))}>{Array.from({ length: parts }, (_, i) => <option key={i + 1} value={i + 1}>Archivo {i + 1}: entregas {i * exportSize + 1}–{Math.min((i + 1) * exportSize, selectedCount)}</option>)}</select></>}
      </>}
      <button className="secondary" disabled={!mesa || !selectedCount || !!exporting} onClick={exportMesa}>Descargar Excel con fotos de la mesa</button>
    </div>
    {exporting && <p className="empty" role="status">{exporting}</p>}
    {listError && <p className="bad" role="alert">{listError}</p>}
    {loading ? <p className="empty" role="status">Cargando página…</p> : history && <>
      <p className="page-info">{history.total ? (history.pagina - 1) * history.limite + 1 : 0}–{Math.min(history.pagina * history.limite, history.total)} de {history.total} registros</p>
      {history.items.length === 0 && <p className="empty">No hay entregas con estos filtros.</p>}
      <ul>{history.items.map(record => <li key={record.folio}>
        <strong>{record.folio}</strong><small>{reportDate(record.fecha)}</small>
        {record.operador && <small>Registró: {record.operador}</small>}
        {record.nombre && <p>{record.nombre}<small>{record.direccion}</small></p>}
        <div className="links">
          <a href={api + "?foto=" + encodeURIComponent(record.folio)} target="_blank" rel="noreferrer">Ver entrega</a>
          {record.tieneINE ? <a href={api + "?foto=" + encodeURIComponent(record.folio) + "&tipo=ine"} target="_blank" rel="noreferrer">Ver INE</a> : <small>Sin foto de INE (registro anterior)</small>}
          <a href={"https://www.google.com/maps?q=" + encodeURIComponent(record.lat + "," + record.lng)} target="_blank" rel="noreferrer">Ver mapa</a>
        </div>
      </li>)}</ul>
      <nav className="pagination" aria-label="Páginas del historial">
        <button className="secondary" disabled={history.pagina <= 1 || !!exporting} onClick={() => setPage(value => value - 1)}>Anterior</button>
        <span>Página {history.pagina} de {history.paginas}</span>
        <button className="secondary" disabled={history.pagina >= history.paginas || !!exporting} onClick={() => setPage(value => value + 1)}>Siguiente</button>
      </nav>

    </>}
    <ResetDeliveries disabled={!!exporting} onBusy={busy => { setResetting(busy); onBusy(busy); }} onReset={() => { setPage(1); setRefresh(value => value + 1); }} />
  </section>;
}

