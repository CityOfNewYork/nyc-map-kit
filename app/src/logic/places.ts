/**
 * places.ts — boroughs, neighborhoods and ZIP codes, matched without a network call.
 *
 * Geoclient answers addresses and intersections but rejects "Harlem", "the Bronx" and
 * "10027". build/places.py writes those names to app/public/places.json, and this file
 * matches a query against them before anything is sent to Geoclient.
 *
 * A query matches only if every word in it is accounted for: a borough, a neighborhood, a
 * known ZIP code, or a filler word such as "NY". Anything left over ("120 Broadway") means
 * the query is an address, and the caller sends it to Geoclient instead. When a query
 * names more than one place, the most specific wins: "Harlem, Manhattan" is Harlem, and
 * "10027 Manhattan" is the ZIP code.
 *
 * Failing that, words that all appear in one neighborhood's name, and in no other's, name
 * it: "Lefferts Garden" is Prospect Lefferts Gardens. A plural counts as its singular. Words
 * that fit several names, such as "Park", match none, and the query goes to Geoclient.
 */

/** Longitude and latitude. */
export type LngLat = [number, number];
/** West, south, east, north. */
export type BBox = [number, number, number, number];

/** One entry in places.json: a representative point and the shape's bounding box. */
interface Entry {
  c: LngLat;
  bb: BBox;
}

/** places.json, keyed by normalized name, and the 2020 NTAs' names by code. */
export interface PlacesDoc {
  boroughs: Record<string, Entry & { d: string }>;
  nbhds: Record<string, Entry & { d: string; b: string }>;
  zips: Record<string, Entry>;
  /** "MN0101" -> "Financial District-Battery Park City": the neighborhood a Geoclient
   *  result is in, which Geoclient gives by code only. */
  ntas: Record<string, string>;
}

/** What a search found: a place from places.json or a match from Geoclient. */
export interface Found {
  /** "location" is the reader's own, from the browser (see Search's Use my location). */
  kind: "borough" | "nbhd" | "zip" | "address" | "intersection" | "landmark" | "location";
  /** The place's own name: "Harlem", "10027", "120 Broadway", "Yankee Stadium", or an
   *  intersection's first street. */
  name: string;
  /** An intersection's second street. */
  cross: string | null;
  /** The borough the place is in, when it is not itself a borough or a ZIP code. */
  borough: string | null;
  center: LngLat;
  /** The area to frame, for a borough, neighborhood or ZIP code. */
  bbox: BBox | null;
  /** From Geoclient, when it gives them: the ZIP code, and the 2020 NTA code of the
   *  neighborhood. */
  zip?: string;
  nta?: string;
}

/** Words a resident adds that name no place smaller than the city. */
const FILLER = new Set(["ny", "nyc", "new", "york", "city", "usa", "us"]);

/** Lowercase, drop apostrophes ("Hell's" -> "hells"), punctuation to spaces. Must match
 *  `norm` in build/places.py, which made the keys. */
export function normalize(s: string): string {
  return s.toLowerCase().replace(/['\u2019]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/** A matcher over one places.json. Keys are tried longest first, so "east harlem" is
 *  found before "harlem". */
export function placeMatcher(doc: PlacesDoc): (query: string) => Found | null {
  const longestFirst = (keys: string[]) => keys.slice().sort((a, b) => b.length - a.length);
  const boroughKeys = longestFirst(Object.keys(doc.boroughs));
  const nbhdKeys = longestFirst(Object.keys(doc.nbhds));

  // Each neighborhood's words, singular, for a query that names only part of one.
  const singular = (w: string) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);
  const nbhdWords = nbhdKeys.map((k) => ({ k, words: new Set(k.split(" ").map(singular)) }));

  /** The one neighborhood, in `borough` if given, whose name holds every one of `words`;
   *  null when none does or more than one. */
  function partly(words: string[], borough: string | null): string | null {
    if (!words.length || words.some((w) => /\d/.test(w))) return null;
    const hits = nbhdWords.filter(({ k, words: name }) =>
      words.every((w) => name.has(singular(w)))
      && (!borough || doc.nbhds[k].b === doc.boroughs[borough].d));
    return hits.length === 1 ? hits[0].k : null;
  }

  /** Take the first key found as whole words in `s`; return it and what is left. */
  function take(s: string, keys: string[]): [string | null, string] {
    for (const k of keys) {
      if (s.includes(` ${k} `)) return [k, s.replace(` ${k} `, " ")];
    }
    return [null, s];
  }

  return function match(query: string): Found | null {
    let s = ` ${normalize(query)} `;
    if (!s.trim()) return null;
    let boroughKey: string | null;
    let nbhdKey: string | null;
    [nbhdKey, s] = take(s, nbhdKeys);
    [boroughKey, s] = take(s, boroughKeys);
    const words = s.split(" ").filter((w) => w && !FILLER.has(w));
    const zips = words.filter((w) => /^\d{5}$/.test(w));
    if (words.length !== zips.length || zips.some((z) => !doc.zips[z]) || zips.length > 1) {
      const named = nbhdKey || zips.length ? null : partly(words, boroughKey);
      if (!named) return null;
      nbhdKey = named;
    }

    if (nbhdKey) {
      const e = doc.nbhds[nbhdKey];
      return { kind: "nbhd", name: e.d, cross: null, borough: e.b, center: e.c, bbox: e.bb };
    }
    if (zips.length) {
      const e = doc.zips[zips[0]];
      return { kind: "zip", name: zips[0], cross: null, borough: null, center: e.c, bbox: e.bb };
    }
    if (boroughKey) {
      const e = doc.boroughs[boroughKey];
      return { kind: "borough", name: e.d, cross: null, borough: null, center: e.c, bbox: e.bb };
    }
    return null;
  };
}
