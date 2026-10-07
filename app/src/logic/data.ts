/**
 * data.ts — shaping the loaded files into what the list, the card and the map need.
 *
 * Pure functions over the GeoJSON and orgs.json. No DOM, no map: everything here is a
 * fact about the records, computed once when they load.
 */
import type { Position } from "geojson";
import type { Config, Org, OrgsDoc, PreparedData, Site, SiteCollection } from "./types.ts";

/**
 * How close two records have to be, in metres, for the card to offer a stepper between
 * them. A map sets its own with `coLocationRadiusM` in config.json.
 *
 * It is a fixed ground distance rather than a function of zoom, so which records are
 * grouped does not change as the reader zooms in or out.
 */
export const CO_LOCATION_RADIUS_M = 35;

/**
 * The order the list presents the boroughs in — neither alphabetical nor by site count,
 * but the order this map is asked to present them in.
 *
 * Anything the data does not put in one of these — "Citywide" in the ABAWD snapshot, or a
 * blank — sorts after all of them rather than being dropped, because a site with an
 * unexpected borough is still a site somebody can volunteer at. A map with different
 * borough values than this list sorts them all to the end, alphabetically by whatever it
 * does say, which is a visible fallback rather than a silent scramble.
 */
export const BOROUGH_ORDER = ["Bronx", "Manhattan", "Queens", "Brooklyn", "Staten Island"];

/** A site's position in BOROUGH_ORDER, or one past the end for anything not in it. */
export function boroughRank(site: Site): number {
  const at = BOROUGH_ORDER.indexOf(site.properties.borough as string);
  return at < 0 ? BOROUGH_ORDER.length : at;
}

/**
 * The list's order. Sorted north to south, so the list runs down the city the way the
 * map does: scroll the list and you travel from the Bronx to the South Shore. An
 * alphabetical order put the rows in an order the map cannot show, which made the two
 * halves of the block feel like two datasets; geography is the one ordering both can
 * agree on. Ties fall back to organization and address so the order never depends on
 * how the source file was written.
 *
 * Borough first, then north to south inside it, so the list reads down the map the way
 * a reader scans it. Org name and address only break ties between sites at the same
 * latitude, which keeps the order stable between loads.
 */
export function compareSites(a: Site, b: Site): number {
  return boroughRank(a) - boroughRank(b) ||
    (a.properties.borough || "").localeCompare(b.properties.borough || "") ||
    b.geometry.coordinates[1] - a.geometry.coordinates[1] ||
    a.properties.org.localeCompare(b.properties.org) ||
    a.properties.address.localeCompare(b.properties.address);
}

export function normalizeOrgs(doc: OrgsDoc): Org[] {
  const list = Array.isArray(doc) ? doc : (doc.orgs || []);
  return list.map((o) => Object.assign({}, o, { sites: o.sites || [] }));
}

/**
 * orgs.json describes the whole dataset, but `data=` can point at a subset — the one-site
 * demo iframe is exactly that case. Keep only the organizations and sites that are
 * actually on this map, so the counts and the list describe what the reader can see.
 */
export function restrictToLoadedSites(orgs: Org[], byId: Map<string, Site>): Org[] {
  const out: Org[] = [];
  for (const org of orgs) {
    const sites = org.sites.filter((s) => byId.has(s.id));
    if (sites.length) out.push(Object.assign({}, org, { sites }));
  }
  return out;
}

/**
 * Fallback when there is no orgs.json: build the org list from the features themselves.
 * The card then shows only what the features carry — the long org prose lives in
 * orgs.json, so it is simply absent. Documented in the README §Embed contract.
 */
export function groupByOrgProperty(features: Site[]): Org[] {
  const out = new Map<string, Org>();
  for (const f of features) {
    const p = f.properties;
    const key = p.org_id || p.org;
    let org = out.get(key);
    if (!org) {
      org = { org_id: key, name: p.org, dba: p.dba, website: p.website, phone: p.phone,
              org_type: p.org_type, sites: [] };
      out.set(key, org);
    }
    org.sites.push({
      id: p.id, address: p.address, borough: p.borough,
      lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
    });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Metres between two [lon, lat] pairs. Flat-earth, which is exact enough at tens of metres. */
export function metresBetween(a: Position, b: Position): number {
  const x = (b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180) * 111320;
  const y = (b[1] - a[1]) * 110540;
  return Math.hypot(x, y);
}

/**
 * Group the features: sets of records within `radius` metres of one another. Computed
 * once, from the coordinates, rather than from what overlaps on screen — at city zoom a
 * pixel is 116 m.
 *
 * A record joins a group only if it is within the radius of EVERY member already in it,
 * not just the nearest one. Single-link grouping would chain — A near B, B near C — into
 * a group whose ends are further apart than the radius. Data order decides the seed, so
 * the grouping is deterministic.
 *
 * Returns a map from each site id to every feature in its group, itself included.
 */
export function indexByLocation(
  features: Site[], radius = CO_LOCATION_RADIUS_M,
): Map<string, Site[]> {
  const groups: Site[][] = [];
  for (const f of features) {
    const here = f.geometry.coordinates;
    const group = groups.find((g) => g.every(
      (other) => metresBetween(here, other.geometry.coordinates) <= radius));
    if (group) group.push(f);
    else groups.push([f]);
  }
  const at = new Map<string, Site[]>();
  for (const group of groups) {
    for (const f of group) at.set(f.properties.id, group);
  }
  return at;
}

/** Every record in this feature's group, in data order, including itself. */
export function coincidentWith(atCoord: Map<string, Site[]>, feature: Site): Site[] {
  return atCoord.get(feature.properties.id) || [feature];
}

/**
 * Everything the block derives from the three loaded files, in one object: the
 * features and their index, the organizations restricted to what is on this map, the
 * groups of nearby records, and the data's date.
 */
export function prepareData(
  config: Config, data: SiteCollection, orgsDoc: OrgsDoc | null,
): PreparedData {
  const features = data.features;
  const byId = new Map<string, Site>();
  for (const f of features) byId.set(f.properties.id, f);
  const radius = Number(config.coLocationRadiusM) > 0
    ? Number(config.coLocationRadiusM) : CO_LOCATION_RADIUS_M;
  const orgs = restrictToLoadedSites(
    orgsDoc ? normalizeOrgs(orgsDoc) : groupByOrgProperty(features), byId);
  const orgById = new Map<string, Org>();
  for (const org of orgs) orgById.set(org.org_id, org);
  return {
    features,
    byId,
    orgs,
    orgById,
    atCoord: indexByLocation(features, radius),
    generated:
      data.generated || (orgsDoc && (orgsDoc as { generated?: string }).generated) || "",
  };
}
