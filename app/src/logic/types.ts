/**
 * types.ts — the shapes of the three files the block loads, and of what it makes of them.
 *
 * config.json, the point data (sites.geojson) and orgs.json are fetched at runtime, so
 * nothing checks the files against these types. They describe what the code expects,
 * which is what build/build.py writes.
 *
 * A record's type lists the fields the code reads by name. The fields config.json names
 * are read by key instead, through `read()` in card.ts, so a map can show a new column
 * without a change here.
 */
import type { Feature, FeatureCollection, Point } from "geojson";

// ----------------------------------------------------------------------- config.json

/** A field named in config.json: read off the site's own properties, or off its org. */
export interface FieldRef {
  key: string;
  source: "site" | "org";
}

/** A button in the row under the address, or a labelled field below it. */
export interface LabelledFieldRef extends FieldRef {
  label: string;
  /** How the value links: a phone number or a website. Plain text when absent. */
  as?: "tel" | "url";
}

/** config.json. Its `_README` says what each part does. */
export interface Config {
  title?: string;
  coLocationRadiusM?: number;
  /** false drops the link; true links the coordinate; `query` searches for those fields. */
  openInMaps?: boolean | { query: FieldRef[] };
  actions?: LabelledFieldRef[];
  card?: LabelledFieldRef[];
}

// ------------------------------------------------------------------------ point data

/** One site's properties in the point data. */
export interface SiteProperties {
  /** Stable across data refreshes: `?site=` and map-core's `select()` use it. */
  id: string;
  org: string;
  /** The key into orgs.json. */
  org_id: string;
  address: string;
  borough?: string;
  dba?: string;
  website?: string;
  phone?: string;
  org_type?: string;
  /** A hand-corrected Google Maps query from data/overrides.json; absent on most sites. */
  maps_query?: string;
}

export type Site = Feature<Point, SiteProperties>;

export interface SiteCollection extends FeatureCollection<Point, SiteProperties> {
  /** The day the data was built, as "2026-09-15". */
  generated?: string;
}

// -------------------------------------------------------------------------- orgs.json

/** One of an organization's sites, as orgs.json lists them. */
export interface OrgSite {
  id: string;
  address: string;
  borough?: string;
  lon: number;
  lat: number;
}

export interface Org {
  org_id: string;
  name: string;
  dba?: string;
  website?: string;
  phone?: string;
  org_type?: string;
  sites: OrgSite[];
}

/** An organization as orgs.json may write it, before normalizeOrgs: `sites` can be missing. */
export type OrgEntry = Omit<Org, "sites"> & { sites?: OrgSite[] };

/** orgs.json: an object with `orgs`, which is what build.py writes, or a bare array. */
export type OrgsDoc = OrgEntry[] | { generated?: string; orgs?: OrgEntry[] };

// ------------------------------------------------------------------ what App holds

/** Everything prepareData derives from the loaded files. */
export interface PreparedData {
  features: Site[];
  byId: Map<string, Site>;
  /** The organizations with at least one site on this map. */
  orgs: Org[];
  orgById: Map<string, Org>;
  /** Each site's id -> every site in its group, itself included. See indexByLocation. */
  atCoord: Map<string, Site[]>;
  /** The data's date, or "" when neither file carries one. */
  generated: string;
}

/** config.json and the point data as loaded, plus what prepareData derives from them. */
export interface Model extends PreparedData {
  config: Config;
  data: SiteCollection;
}
