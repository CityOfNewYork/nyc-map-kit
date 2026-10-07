/** The two globals the block writes. */
interface Window {
  /** The host page's analytics queue; see logic/analytics.ts. */
  dataLayer?: Record<string, unknown>[];
  /** The main map's map-core API, for driving the map from the console. See App.tsx. */
  nycMapKit?: unknown;
}
