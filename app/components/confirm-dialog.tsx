"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

type ConfirmRequest = { title: string; message: string; confirmLabel?: string; cancelLabel?: string; destructive?: boolean };

export function useConfirmDialog() {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const messageId = useId();
  const resolver = useRef<((confirmed: boolean) => void) | null>(null);
  const [request, setRequest] = useState<ConfirmRequest | null>(null);

  const close = useCallback((confirmed: boolean) => {
    dialog.current?.close();
    const resolve = resolver.current;
    resolver.current = null;
    setRequest(null);
    resolve?.(confirmed);
  }, []);

  const confirm = useCallback((next: ConfirmRequest) => new Promise<boolean>(resolve => {
    resolver.current?.(false);
    resolver.current = resolve;
    setRequest(next);
  }), []);

  useEffect(() => {
    if (!request || !dialog.current || dialog.current.open) return;
    dialog.current.showModal();
  }, [request]);
  useEffect(() => () => { resolver.current?.(false); resolver.current = null; }, []);

  const confirmationDialog = <dialog ref={dialog} className="entry-dialog confirm-dialog" aria-labelledby={titleId} aria-describedby={messageId} onCancel={event => { event.preventDefault(); close(false); }}>
    {request && <><div className="modal-top"><div><p className="eyebrow">Please confirm</p><h2 id={titleId}>{request.title}</h2></div><button type="button" className="close-button" aria-label="Cancel" onClick={() => close(false)}>×</button></div><p id={messageId} className="confirm-message">{request.message}</p><div className="form-footer"><button type="button" className="secondary-button" autoFocus onClick={() => close(false)}>{request.cancelLabel ?? "Cancel"}</button><button type="button" className={request.destructive ? "danger-button" : "primary-button"} onClick={() => close(true)}>{request.confirmLabel ?? "Confirm"}</button></div></>}
  </dialog>;

  return { confirm, dialog: confirmationDialog };
}
