/** The two globals the block writes. */
interface Window {
  /** Google Tag Manager's queue, which the page's snippet reads; see logic/analytics.ts. */
  dataLayer?: Record<string, unknown>[];
  /** The main map's map-core API, for driving the map from the console. See App.tsx. */
  nycMapKit?: unknown;
}
