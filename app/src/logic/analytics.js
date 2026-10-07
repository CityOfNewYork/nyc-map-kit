/** Push an analytics event. The host page's tag reads window.dataLayer. */
export function track(event, payload) {
  window.dataLayer = window.dataLayer || [];
  const row = Object.assign({ event }, payload);
  window.dataLayer.push(row);
  console.log("[dataLayer]", row);
}
