/**
 * In-app dialog (Grok-App style). Never use window.prompt / confirm / alert
 * in Tauri — they are unreliable. All product prompts go through this.
 */

import { useEffect, useId, useState } from "react";

export type AppDialogRequest =
  | {
      kind: "prompt";
      title: string;
      message?: string;
      initial?: string;
      placeholder?: string;
      confirmLabel?: string;
      cancelLabel?: string;
      multiline?: boolean;
      resolve: (value: string | null) => void;
    }
  | {
      kind: "confirm";
      title: string;
      message: string;
      confirmLabel?: string;
      cancelLabel?: string;
      danger?: boolean;
      resolve: (ok: boolean) => void;
    }
  | {
      kind: "select";
      title: string;
      message?: string;
      options: Array<{ id: string; label: string; description?: string }>;
      resolve: (id: string | null) => void;
    };

export function AppDialogHost({
  dialog,
}: {
  dialog: AppDialogRequest | null;
}) {
  const titleId = useId();
  const [promptValue, setPromptValue] = useState("");

  useEffect(() => {
    if (!dialog) return;
    if (dialog.kind === "prompt") setPromptValue(dialog.initial ?? "");
  }, [dialog]);

  useEffect(() => {
    if (!dialog) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (dialog.kind === "confirm") dialog.resolve(false);
        else dialog.resolve(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog]);

  if (!dialog) return null;

  const close = () => {
    if (dialog.kind === "confirm") dialog.resolve(false);
    else dialog.resolve(null);
  };

  return (
    <div className="app-dialog-overlay" role="presentation" onMouseDown={close}>
      <div
        className="app-dialog modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="app-dialog-head">
          <h2 id={titleId}>{dialog.title}</h2>
        </header>
        <div className="app-dialog-body">
          {dialog.message && <p className="app-dialog-message">{dialog.message}</p>}
          {dialog.kind === "prompt" &&
            (dialog.multiline ? (
              <textarea
                className="app-dialog-input"
                value={promptValue}
                placeholder={dialog.placeholder}
                autoFocus
                rows={4}
                onChange={(e) => setPromptValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    dialog.resolve(promptValue);
                  }
                }}
              />
            ) : (
              <input
                className="app-dialog-input"
                value={promptValue}
                placeholder={dialog.placeholder}
                autoFocus
                onChange={(e) => setPromptValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    dialog.resolve(promptValue);
                  }
                }}
              />
            ))}
          {dialog.kind === "select" && (
            <ul className="app-dialog-options">
              {dialog.options.map((opt) => (
                <li key={opt.id}>
                  <button
                    type="button"
                    className="app-dialog-option"
                    onClick={() => dialog.resolve(opt.id)}
                  >
                    <strong>{opt.label}</strong>
                    {opt.description && <small>{opt.description}</small>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <footer className="app-dialog-actions">
          <button type="button" className="secondary-button" onClick={close}>
            {dialog.kind === "confirm"
              ? dialog.cancelLabel ?? "取消"
              : dialog.kind === "prompt"
                ? dialog.cancelLabel ?? "取消"
                : "关闭"}
          </button>
          {dialog.kind === "confirm" && (
            <button
              type="button"
              className={dialog.danger ? "primary-button danger" : "primary-button"}
              autoFocus
              onClick={() => dialog.resolve(true)}
            >
              {dialog.confirmLabel ?? "确定"}
            </button>
          )}
          {dialog.kind === "prompt" && (
            <button
              type="button"
              className="primary-button"
              onClick={() => dialog.resolve(promptValue)}
            >
              {dialog.confirmLabel ?? "确定"}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

/** Promise helpers for use with App-level dialog state. */
export function askPrompt(
  setDialog: (d: AppDialogRequest | null) => void,
  options: Omit<Extract<AppDialogRequest, { kind: "prompt" }>, "kind" | "resolve">,
): Promise<string | null> {
  return new Promise((resolve) => {
    setDialog({
      kind: "prompt",
      ...options,
      resolve: (value) => {
        setDialog(null);
        resolve(value);
      },
    });
  });
}

export function askConfirm(
  setDialog: (d: AppDialogRequest | null) => void,
  options: Omit<Extract<AppDialogRequest, { kind: "confirm" }>, "kind" | "resolve">,
): Promise<boolean> {
  return new Promise((resolve) => {
    setDialog({
      kind: "confirm",
      ...options,
      resolve: (ok) => {
        setDialog(null);
        resolve(ok);
      },
    });
  });
}

export function askSelect(
  setDialog: (d: AppDialogRequest | null) => void,
  options: Omit<Extract<AppDialogRequest, { kind: "select" }>, "kind" | "resolve">,
): Promise<string | null> {
  return new Promise((resolve) => {
    setDialog({
      kind: "select",
      ...options,
      resolve: (id) => {
        setDialog(null);
        resolve(id);
      },
    });
  });
}
