"use client";
import { useRef, useState } from "react";
export function ResetDeliveries({ disabled, onBusy, onReset }: { disabled: boolean; onBusy: (busy: boolean) => void; onReset: () => void }) {
  const [open, setOpen] = useState(false), [confirmation, setConfirmation] = useState(""), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const active = useRef(false);
  async function reset() {
    if (active.current || confirmation !== "RESTABLECER") return;
    active.current = true; setBusy(true); onBusy(true); setNotice("");
    try {
      let job: string | undefined;
      for (;;) {
        const response = await fetch("/api/restablecer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmacion: confirmation, job }) });
        const data = await response.json() as { error?: string; terminado: boolean; job?: string };
        if (!response.ok) throw Error(data.error ?? "No se pudo restablecer.");
        if (data.terminado) break;
        job = data.job;
      }
      setOpen(false); setConfirmation(""); setNotice("Se eliminaron los registros y las fotos. Los folios de todas las mesas comienzan nuevamente en 1.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "No se completó el restablecimiento. Puedes reanudar con el mismo botón."); }
    finally { active.current = false; setBusy(false); onBusy(false); onReset(); }
  }
  return <div className="reset-box">
    <button className="danger" disabled={disabled || busy} onClick={() => { setOpen(true); setNotice(""); }}>Restablecer registros y fotos</button>
    {open && <div role="alertdialog" aria-labelledby="reset-title" aria-describedby="reset-description">
      <h3 id="reset-title">Restablecer todas las mesas</h3>
      <p id="reset-description">Se borrarán permanentemente todas las entregas, los datos personales y las fotos de INE y de entrega, incluidos los registros anteriores. Los folios de las 16 mesas volverán a empezar en 1. Descarga tus reportes antes de continuar. Esta acción no se puede deshacer.</p>
      <label htmlFor="reset-confirmation">Escribe RESTABLECER para confirmar</label>
      <input id="reset-confirmation" autoComplete="off" value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)} />
      <div className="actions"><button className="danger" disabled={confirmation !== "RESTABLECER" || busy} onClick={() => void reset()}>Borrar definitivamente</button><button className="secondary" disabled={busy} onClick={() => { setOpen(false); setConfirmation(""); }}>Cancelar</button></div>
    </div>}
    {busy && <p role="status">Restableciendo registros y borrando fotos… Mantén esta página abierta.</p>}
    {notice && <p role="status">{notice}</p>}
  </div>;
}
