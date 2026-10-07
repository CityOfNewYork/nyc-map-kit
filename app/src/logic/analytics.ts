/** Push an analytics event. The host page's tag reads window.dataLayer. */
export function track(event: string, payload: Record<string, unknown>): void {
  window.dataLayer = window.dataLayer || [];
  const row = Object.assign({ event }, payload);
  window.dataLayer.push(row);
  console.log("[dataLayer]", row);
}
