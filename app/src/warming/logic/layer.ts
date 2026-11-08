/**
 * layer.ts — warming centers read from an ArcGIS Online feature layer, the way the finders on
 * finder.nyc.gov read their sites: the browser queries a public, query-only layer as GeoJSON.
 *
 * The layer holds the 28 sample centers (warming/sample-centers.geojson) under the same field
 * names. ArcGIS changed three things when it stored them, which centerFromRecord undoes.
 */
import type { Site, SiteCollection, SiteProperties } from "../../logic/types.ts";

/** "PROTOTYPE – Warming centers sample (data)" in NYCMaps, NYC's ArcGIS Online organization. */
const LAYER = "https://services6.arcgis.com/yG5s3afENB5iO9fj/arcgis/rest/services/"
  + "PROTOTYPE_%E2%80%93_Warming_centers_sample_(data)/FeatureServer/0";

/** The query for every center, as GeoJSON. */
export const LAYER_QUERY = `${LAYER}/query?${new URLSearchParams({
  where: "1=1",
  outFields: "*",
  f: "geojson",
})}`;

type LayerRecord = Record<string, string | number | null>;

interface LayerResponse {
  features?: { geometry: Site["geometry"] | null; properties: LayerRecord }[];
  properties?: { exceededTransferLimit?: boolean };
  error?: { message?: string; details?: string[] };
}

/** A record's fields as the page reads them. ArcGIS keeps `opens` as a time of day
 *  ("07:00:00"; `closes` stays text, since "24:00" is not one), yes or no as 1 or 0, and
 *  an empty field as null; it also adds its own ObjectId. */
export function centerFromRecord(record: LayerRecord): SiteProperties {
  const properties: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(record)) {
    if (value !== null && field !== "ObjectId") properties[field] = value;
  }
  if (typeof record.opens === "string") properties.opens = record.opens.slice(0, 5);
  for (const field of ["wheelchair", "pets"]) {
    if (typeof record[field] === "number") properties[field] = record[field] === 1;
  }
  return properties as unknown as SiteProperties;
}

/** The layer's records as warming centers. Records without a point are left out. */
export function centersFromLayer(data: LayerResponse): SiteCollection {
  const features: Site[] = [];
  for (const { geometry, properties } of data.features ?? []) {
    if (geometry) features.push({ type: "Feature", geometry, properties: centerFromRecord(properties) });
  }
  return { type: "FeatureCollection", features };
}

/** The centers in the layer. Throws when the layer can't answer in full: ArcGIS reports
 *  most errors with a 200 status, and cuts a long answer short without failing. */
export async function loadLayerCenters(): Promise<SiteCollection> {
  const resp = await fetch(LAYER_QUERY);
  if (!resp.ok) throw new Error(`The layer returned ${resp.status}`);
  const data = await resp.json() as LayerResponse;
  if (data.error || !Array.isArray(data.features)) {
    throw new Error(`The layer returned an error: ${data.error?.details?.join("; ") || data.error?.message || "no features"}`);
  }
  if (data.properties?.exceededTransferLimit) {
    throw new Error("The layer has more centers than one query returns");
  }
  return centersFromLayer(data);
}
