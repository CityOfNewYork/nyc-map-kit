/**
 * The committed data and config files against what the code reads from them. Nothing
 * checks these files at runtime (see types.ts), so a typo in a config.json or a bad row
 * from a build script would otherwise hide a card row or misplace a pin without an error.
 */
import { readFileSync, readdirSync } from "node:fs";
import type { FeatureCollection, Point } from "geojson";
import { describe, expect, test } from "vitest";
import { CENTER_CONFIG, CENTER_KINDS } from "../warming/logic/centers.ts";
import { DATASETS } from "../warming/logic/dataset.ts";
import { minutesOf } from "../warming/logic/hours.ts";
import { normalizeOrgs } from "./data.ts";
import type { Config, FieldRef, OrgsDoc, SiteCollection } from "./types.ts";

const APP = new URL("../../", import.meta.url);
const text = (path: string) => readFileSync(new URL(path, APP), "utf8");
const json = <T>(path: string): T => JSON.parse(text(path));

/** Each map's files, as its page names them on <body>. */
const MAPS = [
  { config: "public/config.json", data: "public/sites.geojson", orgs: "public/orgs.json" },
  { config: "public/computer-centers/config.json", data: "public/computer-centers/sites.geojson" },
];
const WARMING_SAMPLES = Object.values(DATASETS).map((file) => `public/${file}`);
const WARMING = ["public/warming/centers.geojson", ...WARMING_SAMPLES];

/** The fields a config names, by where the card, the Maps link and the pins read them. */
function fieldRefs(config: Config): FieldRef[] {
  const query = typeof config.openInMaps === "object" ? config.openInMaps.query : undefined;
  return [
    ...config.actions ?? [], ...config.facts ?? [], ...config.card ?? [],
    ...config.updated ? [config.updated] : [],
    ...config.openInMaps === false ? [] : query ?? [{ key: "address", source: "site" } as const],
    ...config.pins ? [{ key: config.pins.field, source: "site" } as const] : [],
  ];
}

/** `source.key` for each field no record carries. */
function missingFields(refs: FieldRef[], data: string, orgs?: string): string[] {
  const sites = json<SiteCollection>(data).features.map((f) => f.properties);
  const records = { site: sites, org: orgs ? normalizeOrgs(json<OrgsDoc>(orgs)) : [] };
  return refs
    .filter(({ key, source }) =>
      !records[source].some((r) => (r as unknown as Record<string, unknown>)[key]))
    .map(({ key, source }) => `${source}.${key}`);
}

describe("each dataset", () => {
  const city = json<{ geometry: { coordinates: number[][][][] } }>("src/core/city-limits.json");
  const points = city.geometry.coordinates.flat(2);
  const [west, east] = [Math.min(...points.map((p) => p[0])), Math.max(...points.map((p) => p[0]))];
  const [south, north] = [Math.min(...points.map((p) => p[1])), Math.max(...points.map((p) => p[1]))];

  test.each([...MAPS.map((m) => m.data), ...WARMING])("%s: unique ids, points in the city", (file) => {
    const features = json<SiteCollection>(file).features;
    const ids = features.map((f) => f.properties.id);
    expect(new Set(ids).size).toBe(ids.length);
    const outside = features.filter(({ geometry: { type, coordinates: [lon, lat] } }) =>
      type !== "Point" || lon < west || lon > east || lat < south || lat > north);
    expect(outside.map((f) => f.properties.id)).toEqual([]);
  });

  test("subway-stations.geojson: a named point in the city for each station complex", () => {
    const features = json<FeatureCollection<Point, { name: string; routes: string; ada: number }>>(
      "public/subway-stations.geojson").features;
    expect(features.length).toBeGreaterThan(400);
    const bad = features.filter(({ geometry: { type, coordinates: [lon, lat] }, properties: p }) =>
      type !== "Point" || lon < west || lon > east || lat < south || lat > north
      || !p.name || !p.routes || ![0, 1, 2].includes(p.ada));
    expect(bad.map((f) => f.properties.name)).toEqual([]);
  });

  test("every SNAP site's organization is in orgs.json", () => {
    const orgs = new Set(normalizeOrgs(json<OrgsDoc>("public/orgs.json")).map((o) => o.org_id));
    const sites = json<SiteCollection>("public/sites.geojson").features;
    expect(sites.filter((f) => !orgs.has(f.properties.org_id)).map((f) => f.properties.id))
      .toEqual([]);
  });
});

describe("config", () => {
  test.each(MAPS)("every field $config names is on some record", ({ config, data, orgs }) => {
    expect(missingFields(fieldRefs(json<Config>(config)), data, orgs)).toEqual([]);
  });
  test.each(WARMING_SAMPLES)("every field the warming card names is in %s", (data) => {
    expect(missingFields(fieldRefs(CENTER_CONFIG), data)).toEqual([]);
  });
});

describe("warming centers", () => {
  test.each(WARMING)("%s: every center is a known kind, with hours that read", (file) => {
    const bad = json<SiteCollection>(file).features
      .map((f) => f.properties as unknown as Record<string, string>)
      .filter((p) => !CENTER_KINDS.has(p.type) || minutesOf(p.opens) === null
        || minutesOf(p.closes) === null);
    expect(bad.map((p) => p.id)).toEqual([]);
  });
});

describe("translations", () => {
  const STRING = String.raw`"((?:[^"\\]|\\.)*)"`;
  // t("…") and t(setting || "…"), and plural(n, "one", "other"), which is keyed by "other".
  const T = new RegExp(String.raw`\bt\(\s*(?:[\w.?]+\s*\|\|\s*)?${STRING}`, "g");
  const PLURAL = new RegExp(String.raw`\bplural\(\s*[^,()]+,\s*${STRING},\s*${STRING}`, "g");
  const DATA_T = /<(\w+)\b[^>]*\bdata-t\b[^>]*>([\s\S]*?)<\/\1>/g;
  const unquote = (s: string) => JSON.parse(`"${s}"`) as string;

  /** Every English string the interface shows through t() or plural(). */
  function shown(): Set<string> {
    const out = new Set<string>();
    const files = readdirSync(new URL("src/", APP), { recursive: true, encoding: "utf8" });
    for (const file of files.filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))) {
      const source = text(`src/${file}`);
      for (const m of source.matchAll(T)) out.add(unquote(m[1]));
      for (const m of source.matchAll(PLURAL)) out.add(unquote(m[2]));
    }
    for (const page of readdirSync(APP).filter((f) => f.endsWith(".html"))) {
      for (const m of text(page).matchAll(DATA_T)) {
        out.add(m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
      }
    }
    for (const { config } of MAPS) {
      const c = json<Config>(config);
      for (const field of [...c.actions ?? [], ...c.facts ?? [], ...c.card ?? []]) out.add(field.label);
      for (const label of [c.listLabel, c.filterLabel, c.count?.other]) if (label) out.add(label);
    }
    for (const field of [...CENTER_CONFIG.actions ?? [], ...CENTER_CONFIG.facts ?? [],
      ...CENTER_CONFIG.card ?? []]) out.add(field.label);
    for (const { label } of CENTER_KINDS.values()) out.add(label);
    return out;
  }

  const languages = readdirSync(new URL("src/i18n/", APP)).filter((f) => f.endsWith(".json"));
  const keys = (file: string) => Object.keys(json<object>(`src/i18n/${file}`)).sort();

  test("the scan finds the interface's strings", () => {
    expect(shown()).toContain("Directions");
    expect(shown()).toContain("{n} sites");
    expect(shown()).toContain("Prototype, not a City service.");
  });
  test.each(languages)("%s translates every string the interface shows", (file) => {
    const have = new Set(keys(file));
    expect([...shown()].filter((s) => !have.has(s))).toEqual([]);
  });
  test("every language file has the same keys", () => {
    for (const file of languages) expect(keys(file), file).toEqual(keys(languages[0]));
  });
});
