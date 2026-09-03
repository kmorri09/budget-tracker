"use client";

import { FormEvent, useEffect, useState } from "react";

type Mode = "login" | "create";

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [bootstrapAvailable, setBootstrapAvailable] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/bootstrap").then((response) => response.json()).then((body) => setBootstrapAvailable(Boolean(body.available))).catch(() => undefined);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const endpoint = mode === "create" ? "/api/auth/bootstrap" : "/api/auth/login";
    const body = mode === "create" ? { email: form.get("email"), password: form.get("password"), displayName: form.get("displayName") } : { email: form.get("email"), password: form.get("password") };
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      setError(payload?.error ?? "Unable to continue");
      setBusy(false);
      return;
    }
    window.location.href = "/";
  }

  return <main className="auth-shell"><div className="auth-card"><div className="brand auth-brand"><span className="brand-mark">$</span><span>Budget</span><small>private workspace</small></div><p className="eyebrow">{mode === "create" ? "First-time setup" : "Welcome back"}</p><h1>{mode === "create" ? "Create your budget user" : "Sign in to your budget"}</h1><p className="auth-copy">{mode === "create" ? "Use the approved email address for this private workspace." : "Your budget is private and hosted on Railway."}</p><form onSubmit={submit}>{mode === "create" && <label>Name<input name="displayName" autoComplete="name" placeholder="Owner" required /></label>}<label>Email<input name="email" type="email" autoComplete="email" required /></label><label>Password<input name="password" type="password" autoComplete={mode === "create" ? "new-password" : "current-password"} minLength={12} required /></label>{mode === "create" && <p className="auth-hint">Use at least 12 characters. Your email must match the Railway allow-list.</p>}{error && <p className="auth-error" role="alert">{error}</p>}<button className="primary-button" type="submit" disabled={busy}>{busy ? "Working…" : mode === "create" ? "Create user" : "Sign in"}</button></form>{bootstrapAvailable && <button className="auth-switch" onClick={() => { setMode(mode === "create" ? "login" : "create"); setError(""); }}>{mode === "create" ? "Already have an account? Sign in" : "First deployment? Create the initial user"}</button>}</div></main>;
}
