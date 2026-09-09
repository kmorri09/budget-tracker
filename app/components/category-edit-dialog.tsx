"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Category } from "../../lib/workspace-types";

export default function CategoryEditDialog({ category, onClose, onSaved }: { category: Category; onClose: () => void; onSaved: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const node = dialog.current, previousOverflow = document.body.style.overflow;
    node?.showModal(); document.body.style.overflow = "hidden";
    return () => { node?.close(); document.body.style.overflow = previousOverflow; };
  }, []);

  return <dialog ref={dialog} className="entry-dialog" aria-labelledby={titleId} onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <div className="modal-top"><div><p className="eyebrow">Category settings</p><h2 id={titleId}>Edit {category.name}</h2></div><button type="button" className="close-button" aria-label="Close category editor" disabled={busy} onClick={onClose}>×</button></div>
    <form onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError("");
      const values = Object.fromEntries(new FormData(event.currentTarget));
      try {
        const response = await fetch("/api/categories", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: category.id, name: values.name, icon: values.icon, target: values.target, active: values.active === "on" }) });
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(result?.error ?? "Could not update category.");
        onSaved();
      } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not update category."); } finally { setBusy(false); }
    }}>
      <fieldset disabled={busy}>
        <label>Category name<input name="name" defaultValue={category.name} required maxLength={80} autoFocus /></label>
        <div className="form-grid"><label>Icon (optional)<input name="icon" defaultValue={category.icon === "$" ? "" : category.icon} placeholder="e.g. 🏠" maxLength={4} /></label><label>Target amount<input name="target" type="number" min="0" step="0.01" defaultValue={category.target} required /></label></div>
        <label className="toggle-field"><input name="active" type="checkbox" defaultChecked={category.active} /> Active and available for new activity</label>
      </fieldset>
      <p className="field-help">Deactivating hides this category from new entries while preserving its allocations, spending, obligations, and rolling balance. You can reactivate it later.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-footer"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button></div>
    </form>
  </dialog>;
}
