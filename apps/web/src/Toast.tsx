type ToastProps = {
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel?: () => void;
};

export function Toast({
  message,
  confirmLabel = "OK",
  cancelLabel,
  onConfirm,
  onCancel,
}: ToastProps) {
  return (
    <div className="toast" role="alertdialog" aria-live="assertive">
      <p>{message}</p>
      <div className="toast__actions">
        {cancelLabel && onCancel && (
          <button type="button" className="toast__secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
        )}
        <button type="button" className="toast__primary" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
