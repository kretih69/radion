import { useEffect } from "react";

type NoticeToastProps = {
  message: string;
  onDismiss: () => void;
  /** Auto-dismiss after this many ms. Omit to keep until dismissed. */
  durationMs?: number;
};

export function NoticeToast({
  message,
  onDismiss,
  durationMs = 5000,
}: NoticeToastProps) {
  useEffect(() => {
    if (durationMs <= 0) return;
    const id = window.setTimeout(onDismiss, durationMs);
    return () => window.clearTimeout(id);
  }, [durationMs, message, onDismiss]);

  return (
    <div className="notice-toast" role="status" aria-live="polite">
      <p>{message}</p>
      <button
        type="button"
        className="notice-toast__close"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}
