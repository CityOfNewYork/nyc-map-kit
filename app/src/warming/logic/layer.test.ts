import { readFileSync } from "node:fs";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { SiteCollection } from "../../logic/types.ts";
import { LAYER_QUERY, centerFromRecord, centersFromLayer, loadLayerCenters } from "./layer.ts";

const sample = JSON.parse(readFileSync(
  new URL("../../../public/warming/sample-centers.geojson", import.meta.url), "utf8")) as SiteCollection;
const jacobi = sample.features.find((f) => f.properties.id === "jacobi")!;

/** Jacobi's record as the layer returns it. */
const record = {
  ...jacobi.properties,
  opens: "00:00:00",
  wheelchair: 1,
  pets: 0,
  cross_street: null,
  ObjectId: 1,
} as Record<string, string | number | null>;
const layer = { type: "FeatureCollection", features: [{ geometry: jacobi.geometry, properties: record }] };

describe("centerFromRecord", () => {
  test("gives back the sample file's fields", () => {
    expect(centerFromRecord(record)).toEqual(jacobi.properties);
  });
  test("reads 1 as yes", () => {
    expect(centerFromRecord({ ...record, pets: 1 })).toMatchObject({ wheelchair: true, pets: true });
  });
  test("leaves out empty hours and yes-or-no fields", () => {
    const properties = centerFromRecord({ ...record, opens: null, wheelchair: null });
    expect(properties).not.toHaveProperty("opens");
    expect(properties).not.toHaveProperty("wheelchair");
  });
});

describe("centersFromLayer", () => {
  test("leaves out records without a point", () => {
    const data = { features: [{ geometry: null, properties: record }, ...layer.features] };
    expect(centersFromLayer(data).features).toEqual([
      { type: "Feature", geometry: jacobi.geometry, properties: jacobi.properties }]);
  });
  test("is empty for an answer without records", () => {
    expect(centersFromLayer({}).features).toEqual([]);
  });
});

describe("loadLayerCenters", () => {
  afterEach(() => vi.unstubAllGlobals());
  const answer = (body: unknown, ok = true) => {
    const fetch = vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body }));
    vi.stubGlobal("fetch", fetch);
    return fetch;
  };

  test("queries the layer for every center as GeoJSON", async () => {
    const fetch = answer(layer);
    const data = await loadLayerCenters();
    expect(fetch).toHaveBeenCalledWith(LAYER_QUERY);
    const query = new URL(LAYER_QUERY).searchParams;
    expect(query.get("where")).toBe("1=1");
    expect(query.get("f")).toBe("geojson");
    expect(data.features.map((f) => f.properties.id)).toEqual(["jacobi"]);
  });
  test("fails on an error the layer reports with a 200 status", async () => {
    answer({ error: { code: 400, message: "", details: ["'Invalid field: x' parameter is invalid"] } });
    await expect(loadLayerCenters()).rejects.toThrow("Invalid field");
  });
  test("fails on an error with only a message, or an answer without records", async () => {
    answer({ error: { code: 498, message: "Invalid token." } });
    await expect(loadLayerCenters()).rejects.toThrow("Invalid token.");
    answer({ type: "FeatureCollection" });
    await expect(loadLayerCenters()).rejects.toThrow("no features");
  });
  test("fails rather than show part of the list when the answer is cut short", async () => {
    answer({ ...layer, properties: { exceededTransferLimit: true } });
    await expect(loadLayerCenters()).rejects.toThrow("more centers");
  });
  test("fails on an HTTP error", async () => {
    answer({}, false);
    await expect(loadLayerCenters()).rejects.toThrow("500");
  });
});
