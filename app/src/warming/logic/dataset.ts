/** The sample centers the map can load, by the value of ?dataset=. The 28 are real sites
 *  mixed with invented ones, with made-up phone numbers, entry instructions and dates (the
 *  file's description says which parts); the larger sets add invented centers to those
 *  28, to try the map with many centers. warming/centers.geojson, beside them, is the
 *  list in 311 article KA-03702, retrieved 2026-10-15. */
export const DATASETS = {
  "28": "warming/sample-centers.geojson",
  "1500": "warming/sample-centers-1500.geojson",
  "10000": "warming/sample-centers-10000.geojson",
} as const;

export type Dataset = keyof typeof DATASETS;

/** The 28, which a page with no ?dataset= loads. */
export const DEFAULT_DATASET: Dataset = "28";

/** The set ?dataset= names, or the 28 for anything else. */
export function datasetFromUrl(search: string): Dataset {
  const value = new URLSearchParams(search).get("dataset");
  return value && Object.hasOwn(DATASETS, value) ? value as Dataset : DEFAULT_DATASET;
}
