/** True for Safari / iOS WebKit (including Chrome on iOS). */
export function isWebKit(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  // iPadOS reports as MacIntel with touch
  if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return true;
  return (
    /Safari/i.test(ua) &&
    !/Chrome|Chromium|Edg|OPR|Firefox|CriOS|FxiOS|Android/i.test(ua)
  );
}
