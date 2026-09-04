"use client";

import { FormEvent, useState } from "react";

type Report = {
  dryRun?: boolean;
  fileName?: string;
  cutoff?: string;
  summary?: Record<string, number>;
  skipped?: Record<string, number>;
  warnings?: string[];
  imported?: Record<string, number>;
  ok?: boolean;
  error?: string;
};

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [cutoff, setCutoff] = useState("2026-08-01");
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>, apply = false) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setReport(null);
    const body = new FormData();
    body.set("file", file);
    body.set("cutoffDate", cutoff);
    body.set("apply", String(apply));
    try {
      const response = await fetch("/api/import/notion", { method: "POST", body });
      const data = await response.json() as Report;
      setReport(response.ok ? data : { error: data.error ?? "Import failed." });
    } catch {
      setReport({ error: "Could not reach the import service." });
    } finally {
      setBusy(false);
    }
  }

  const counts = report?.summary ?? report?.imported;
  const warnings = report?.warnings ?? [];
  return <main className="app-shell import-shell"><section className="content-wrap"><header className="topbar"><div><p className="eyebrow">One-time setup</p><h1>Import from Notion</h1></div><a className="secondary-button" href="/">Back to budget</a></header><section className="panel import-panel"><p className="auth-copy">This uploads your private export directly to this Railway app. It is not committed to GitHub. First run a dry run to review what will be imported.</p><form onSubmit={(event) => submit(event)}><label>Notion ZIP export<input type="file" accept=".zip,application/zip" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setReport(null); }} required /></label><label>Cutover date<input type="date" value={cutoff} onChange={(event) => setCutoff(event.target.value)} required /></label><button className="primary-button" type="submit" disabled={!file || busy}>{busy ? "Preparing report…" : "Preview import"}</button></form>{report?.error && <p className="form-error" role="alert">{report.error}</p>}{counts && <div className="import-report" aria-live="polite"><h2>{report?.ok ? "Import complete" : "Dry-run report"}</h2>{report?.fileName && <p className="auth-copy">Source: {report.fileName} · Cutover: {report.cutoff}</p>}<div className="import-counts">{Object.entries(counts).map(([key, value]) => <div key={key}><strong>{value}</strong><span>{key.replace(/([A-Z])/g, " $1")}</span></div>)}</div>{warnings.length ? <div className="import-warnings"><strong>Review before relying on the totals</strong>{warnings.map((warning) => <p key={warning}>{warning}</p>)}</div> : null}{report?.skipped && <details><summary>Skipped or excluded rows</summary><pre>{JSON.stringify(report.skipped, null, 2)}</pre></details>}{report?.dryRun && <button className="primary-button" type="button" disabled={busy} onClick={() => { void submit({ preventDefault() {} } as FormEvent<HTMLFormElement>, true); }}>{busy ? "Importing…" : "Import this report to Railway"}</button>}</div>}</section></section></main>;
}
