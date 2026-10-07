/**
 * data.js — shaping the loaded files into what the list, the card and the map need.
 *
 * Pure functions over the GeoJSON and orgs.json. No DOM, no map: everything here is a
 * fact about the records, computed once when they load.
 */

/**
 * How close two records have to be to count as one location, in metres. A map overrides
 * it with `coLocationRadiusM` in config.json, because the honest number depends on how
 * that dataset's addresses sit on the ground.
 *
 * There is no answer to this in the data: the pair distances in the ABAWD file run
 * continuously from 0 to 160 m with no gap anywhere — the largest jump between two
 * consecutive pair distances in that range is 8 m. So the number comes from what the
 * stepper's label promises, "at this location", and 35 m is the widest radius where that
 * stays true. It catches the same building or a few doors down the same street: 415 and
 * 417 E 151st Street (7.9 m), 265 and 269 Henry Street (15.6 m, two doors of one campus),
 * 701 and 705 Crotona Park North (17.2 m), 282 and 290 E 3rd Street (25.1 m), 117 and
 * 125 Church Avenue (31.6 m), 301 and 309 Henry Street (32.9 m), plus the two pairs that
 * geocode to a single point. Every pair inside 35 m is one organization on one street.
 * The next pair out, at 39.4 m, is on two different streets (W 145th and W 146th), and
 * past there the label stops being honest.
 *
 * It was 25 m, which missed 282 and 290 E 3rd Street by 10 cm — a margin that says more
 * about geocoding precision than about the places.
 *
 * Note that this is NOT "what the user cannot separate by zooming" — that would be 0 m,
 * since at z18 even a 15 m gap is about 35 px. It is a claim about the places, not about
 * the pixels, which is why it is a fixed ground distance and not a function of zoom.
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
export function boroughRank(site) {
  const at = BOROUGH_ORDER.indexOf(site.properties.borough);
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
export function compareSites(a, b) {
  return boroughRank(a) - boroughRank(b) ||
    (a.properties.borough || "").localeCompare(b.properties.borough || "") ||
    b.geometry.coordinates[1] - a.geometry.coordinates[1] ||
    a.properties.org.localeCompare(b.properties.org) ||
    a.properties.address.localeCompare(b.properties.address);
}

export function normalizeOrgs(doc) {
  const list = Array.isArray(doc) ? doc : (doc.orgs || []);
  return list.map((o) => Object.assign({}, o, { sites: o.sites || [] }));
}

/**
 * orgs.json describes the whole dataset, but `data=` can point at a subset — the one-site
 * demo iframe is exactly that case. Keep only the organizations and sites that are
 * actually on this map, so the counts and the list describe what the reader can see.
 */
export function restrictToLoadedSites(orgs, byId) {
  const out = [];
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
export function groupByOrgProperty(features) {
  const out = new Map();
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

/** Metres between two [lon, lat] pairs. Flat-earth, which is exact enough at 35 m. */
export function metresBetween(a, b) {
  const x = (b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180) * 111320;
  const y = (b[1] - a[1]) * 110540;
  return Math.hypot(x, y);
}

/**
 * Group the features into locations: sets of records within `radius` metres of one
 * another. Computed once, from the data, because co-location is a fact about the places —
 * the map only knows about pixels, and a pixel at city zoom is 116 m.
 *
 * A record joins a group only if it is within the radius of EVERY member already in it,
 * not just the nearest one. Single-link grouping would chain — A near B, B near C, and a
 * group containing two records 50 m apart, which is exactly what the label must not
 * claim. Data order decides the seed, so the grouping is deterministic.
 *
 * Returns a map from each site id to every feature at its location, itself included.
 */
export function indexByLocation(features, radius = CO_LOCATION_RADIUS_M) {
  const groups = [];
  for (const f of features) {
    const here = f.geometry.coordinates;
    const group = groups.find((g) => g.every(
      (other) => metresBetween(here, other.geometry.coordinates) <= radius));
    if (group) group.push(f);
    else groups.push([f]);
  }
  const at = new Map();
  for (const group of groups) {
    for (const f of group) at.set(f.properties.id, group);
  }
  return at;
}

/** Every record at this feature's location, in data order, including itself. */
export function coincidentWith(atCoord, feature) {
  return atCoord.get(feature.properties.id) || [feature];
}

/**
 * Everything the block derives from the three loaded files, in one object: the
 * features and their index, the organizations restricted to what is on this map, the
 * co-location groups, and the data's date.
 */
export function prepareData(config, data, orgsDoc) {
  const features = data.features;
  const byId = new Map();
  for (const f of features) byId.set(f.properties.id, f);
  const radius = Number(config.coLocationRadiusM) > 0
    ? Number(config.coLocationRadiusM) : CO_LOCATION_RADIUS_M;
  const orgs = restrictToLoadedSites(
    orgsDoc ? normalizeOrgs(orgsDoc) : groupByOrgProperty(features), byId);
  const orgById = new Map();
  for (const org of orgs) orgById.set(org.org_id, org);
  return {
    features,
    byId,
    orgs,
    orgById,
    atCoord: indexByLocation(features, radius),
    generated: data.generated || (orgsDoc && orgsDoc.generated) || "",
  };
}
