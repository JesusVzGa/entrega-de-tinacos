"use client";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { Worker } from "tesseract.js";
import { parseINE, parseINERegion } from "../lib/delivery";
import { prepareINEImage, type Crop } from "../lib/ine-image";
type Fields = { nombre?: string; direccion?: string };
type Target = "all" | "nombre" | "direccion";
export function INEReader({ disabled, onResult, onBusy, onPhoto }: { disabled: boolean; onResult: (data: Fields) => void; onBusy: (busy: boolean) => void; onPhoto: (photo: Blob) => void }) {
  const [source, setSource] = useState<Blob | null>(null);
  const [preview, setPreview] = useState("");
  const [crop, setCrop] = useState<Crop | null>(null);
  const [status, setStatus] = useState("");
  const [reading, setReading] = useState(false);
  const [raw, setRaw] = useState("");
  const start = useRef<{ x: number; y: number } | null>(null);
  const worker = useRef<Worker | null>(null);
  const generation = useRef(0);
  const active = useRef(false);
  useEffect(() => {
    if (!source) { setPreview(""); return; }
    const url = URL.createObjectURL(source); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [source]);
  useEffect(() => () => { generation.current++; void worker.current?.terminate(); }, []);
  function cancel() {
    generation.current++; active.current = false;
    void worker.current?.terminate(); worker.current = null;
    setReading(false); onBusy(false); setStatus("Lectura detenida. Puedes volver a leer o completar los campos.");
  }
  async function read(photo: Blob, selected: Crop | undefined, target: Target) {
    if (active.current) return;
    const current = ++generation.current;
    active.current = true; setReading(true); onBusy(true); setRaw("");
    setStatus("Preparando imagen y lector…");
    let engine: Worker | undefined;
    let phase = "Leyendo texto";
    try {
      const { createWorker, PSM } = await import("tesseract.js");
      engine = await createWorker("spa", 1, {
        workerPath: "/ocr/worker.min.js", corePath: "/ocr/core", langPath: "/ocr/lang",
        logger: message => {
          if (current === generation.current && message.status === "recognizing text") setStatus(phase + " · " + Math.round(message.progress * 100) + "%");
        },
      });
      if (current !== generation.current) return;
      worker.current = engine;
      let fields: Fields = {};
      let recognized = "";
      const passes = target === "all" ? [
        { psm: PSM.SPARSE_TEXT, enhance: true },
        { psm: PSM.AUTO, enhance: false },
        { psm: PSM.SPARSE_TEXT, enhance: false },
      ] : [{ psm: PSM.SINGLE_BLOCK, enhance: true }, { psm: PSM.SPARSE_TEXT, enhance: false }];
      for (let pass = 0; pass < passes.length; pass++) {
        if (current !== generation.current) return;
        phase = "Lectura " + (pass + 1) + " de " + passes.length;
        setStatus(phase + " · mejorando el reconocimiento…");
        const image = await prepareINEImage(photo, selected, passes[pass].enhance);
        await engine.setParameters({ tessedit_pageseg_mode: passes[pass].psm, user_defined_dpi: "300", preserve_interword_spaces: "1" });
        const result = await engine.recognize(image, { rotateAuto: true });
        if (current !== generation.current) return;
        if (result.data.text.length > recognized.length) recognized = result.data.text;
        if (target === "all") {
          const parsed = parseINE(result.data.text);
          if (!fields.nombre && parsed.nombre) fields.nombre = parsed.nombre.slice(0, 160);
          if (!fields.direccion && parsed.direccion) fields.direccion = parsed.direccion.slice(0, 500);
          if (fields.nombre && fields.direccion) break;
        } else {
          const value = parseINERegion(result.data.text, target);
          if (value) { fields = { [target]: value.slice(0, target === "nombre" ? 160 : 500) }; break; }
        }
      }
      setRaw(recognized.trim());
      const found = target === "all" ? fields.nombre && fields.direccion : fields[target];
      if (fields.nombre || fields.direccion) onResult(fields);
      setStatus(found ? "Lectura terminada. Revisa y corrige los datos antes de confirmar." :
        recognized.trim() ? "Se leyó texto, pero faltan datos. Marca en la imagen solo el nombre o el domicilio y usa el botón correspondiente. Los datos ya capturados se conservan." :
        "No se pudo leer texto. Recorta el área de la credencial, gírala si está de lado y pulsa Volver a leer.");
    } catch {
      if (current === generation.current) setStatus("La lectura no pudo terminar. Pulsa Volver a leer o completa los campos. Los datos ya capturados se conservan.");
    } finally {
      if (engine) await engine.terminate().catch(() => {});
      if (current === generation.current) { active.current = false; worker.current = null; setReading(false); onBusy(false); }
    }
  }
  function point(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    if (!start.current || reading || disabled) return;
    const end = point(event), begin = start.current;
    setCrop({ x: Math.min(begin.x, end.x), y: Math.min(begin.y, end.y), width: Math.abs(end.x - begin.x), height: Math.abs(end.y - begin.y) });
  }
  async function rotate() {
    if (!source || active.current) return;
    const rotated = await prepareINEImage(source, undefined, false, true);
    setSource(rotated); setCrop(null); setRaw(""); setStatus("Imagen girada. Pulsa Volver a leer.");
  }
  const validCrop = crop && crop.width > .02 && crop.height > .02 ? crop : undefined;
  return <div className="ine-reader">
    <label htmlFor="ine">1. Fotografía del frente de la INE</label>
    <input id="ine" type="file" accept="image/*" capture="environment" disabled={disabled || reading} onChange={event => {
      const photo = event.target.files?.[0]; event.target.value = "";
      if (photo) { setSource(photo); onPhoto(photo); setCrop(null); void read(photo, undefined, "all"); }
    }} />
    <small>La foto de la INE es requerida y se guardará junto con la entrega. Solo el administrador podrá consultarla. Revisa el nombre y la dirección antes de guardar.</small>
    {preview && <>
      <small className="good">Foto de INE adjunta. Se conservará completa aunque selecciones un área para leer.</small>
      <div className="ine-photo" aria-label="Vista previa de la INE. Arrastra para seleccionar el área que deseas leer." onPointerDown={event => {
        if (reading || disabled) return;
        start.current = point(event); event.currentTarget.setPointerCapture(event.pointerId); setCrop(null);
      }} onPointerMove={move} onPointerUp={event => { move(event); start.current = null; }} onPointerCancel={() => { start.current = null; }}>
        <img src={preview} alt="INE seleccionada para lectura" draggable={false} />
        {validCrop && <div className="ine-crop" style={{ left: validCrop.x * 100 + "%", top: validCrop.y * 100 + "%", width: validCrop.width * 100 + "%", height: validCrop.height * 100 + "%" }} />}
      </div>
      <small>Si faltan datos, arrastra con el dedo sobre la imagen para encerrar solo el nombre o solo el domicilio.</small>
      <div className="actions">
        <button type="button" className="secondary" disabled={disabled || reading} onClick={() => { if (source) void read(source, validCrop, "all"); }}>{validCrop ? "Leer selección completa" : "Volver a leer"}</button>
        <button type="button" className="secondary" disabled={disabled || reading} onClick={rotate}>Girar foto 90°</button>
        {validCrop && <>
          <button type="button" className="secondary" disabled={disabled || reading} onClick={() => { if (source) void read(source, validCrop, "nombre"); }}>Leer selección como nombre</button>
          <button type="button" className="secondary" disabled={disabled || reading} onClick={() => { if (source) void read(source, validCrop, "direccion"); }}>Leer selección como domicilio</button>
          <button type="button" className="secondary" disabled={disabled || reading} onClick={() => setCrop(null)}>Quitar selección</button>
        </>}
        {reading && <button type="button" className="secondary" onClick={cancel}>Detener lectura</button>}
      </div>
    </>}
    {status && <p className="empty" role="status">{status}</p>}
    {raw && <details><summary>Ver texto reconocido en la foto</summary><pre className="ocr-text">{raw}</pre></details>}
  </div>;
}

