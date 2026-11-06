"use client";
import { useState, type FormEvent } from "react";
import type { SessionInfo } from "../lib/session-types";
export function LoginScreen({ onLogin }: { onLogin: (session: SessionInfo) => void }) {
  const [role, setRole] = useState<"admin" | "operator" | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!role || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(role === "admin" ? { role, password } : { role, name }) });
      const result = await response.json() as SessionInfo & { error?: string };
      if (!response.ok) throw Error(result.error ?? "No se pudo iniciar sesión.");
      setPassword(""); onLogin(result);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo iniciar sesión. Verifica tu conexión."); }
    finally { setBusy(false); }
  }
  function choose(value: "admin" | "operator") { setRole(value); setError(""); setPassword(""); }
  return <main className="login-main">
    <header className="hero">
      <div className="eyebrow">OPERACIÓN EN CAMPO</div><h1>Entrega de tinacos</h1><p>Selecciona tu tipo de acceso para comenzar.</p>
    </header>
    <section className="panel login-panel">
      <h2>Iniciar sesión</h2>
      <div className="login-options">
        <button type="button" className={"login-option " + (role === "admin" ? "chosen" : "")} onClick={() => choose("admin")} disabled={busy} aria-pressed={role === "admin"}><strong>Entrar como administrador</strong><small>Historial, fotos y exportación a Excel.</small></button>
        <button type="button" className={"login-option " + (role === "operator" ? "chosen" : "")} onClick={() => choose("operator")} disabled={busy} aria-pressed={role === "operator"}><strong>Entrar como operador</strong><small>Registro de entregas con tu nombre.</small></button>
      </div>
      {role && <form onSubmit={submit}>
        <fieldset disabled={busy}>
          {role === "admin" ? <>
            <label htmlFor="admin-password">Contraseña del administrador</label>
            <input id="admin-password" type="password" autoComplete="current-password" required maxLength={256} value={password} onChange={event => setPassword(event.target.value)} autoFocus />
          </> : <>
            <label htmlFor="operator-name">Nombre del operador</label>
            <input id="operator-name" autoComplete="name" required minLength={2} maxLength={100} value={name} onChange={event => setName(event.target.value)} placeholder="Escribe tu nombre completo" autoFocus />
            <small>No necesitas contraseña.</small>
          </>}
          <button className="primary" disabled={busy}>{busy ? "Entrando…" : role === "admin" ? "Acceder al administrador" : "Comenzar registros"}</button>
        </fieldset>
      </form>}
      {error && <p className="bad" role="alert">{error}</p>}
    </section>
  </main>;
}

