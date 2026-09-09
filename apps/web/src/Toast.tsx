type ToastProps = {
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Danger styling for irreversible actions (e.g. delete account). */
  danger?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
};

export function Toast({
  message,
  confirmLabel = "OK",
  cancelLabel,
  danger = false,
  onConfirm,
  onCancel,
}: ToastProps) {
  return (
    <div
      className={`toast ${danger ? "toast--danger" : ""}`}
      role="alertdialog"
      aria-live="assertive"
    >
      <p>{message}</p>
      <div className="toast__actions">
        {cancelLabel && onCancel && (
          <button type="button" className="toast__secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
        )}
        <button
          type="button"
          className={danger ? "toast__danger" : "toast__primary"}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
