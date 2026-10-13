/**
 * geocode.ts — addresses, intersections and named places, through NYC Geoclient.
 *
 * Geoclient (https://api.nyc.gov/geoclient/v2/search) is the city's own geocoder, on the
 * same Geosupport data the agencies use. Without a borough in the query it tries all
 * five and returns each borough's answer in borough order, not best first: "37-11 74th
 * st" comes back as Brooklyn and then Queens. So when there is more than one match the
 * resident chooses, and the caller shows them the choices.
 *
 * A misspelled street is rejected in every borough, each with a list of similar street
 * names. When one of those is a close spelling of what was typed ("grand concurse" ->
 * GRAND CONCOURSE, Bronx), it is offered as a suggestion to search again with.
 *
 * The key is a subscription key from the NYC API portal (api-portal.nyc.gov), read from
 * VITE_GEOCLIENT_KEY at build time. A static site cannot keep a key secret: it is in the
 * bundle for anyone who looks.
 */
import type { Found } from "./places.ts";

const ENDPOINT = "https://api.nyc.gov/geoclient/v2/search";
const TIMEOUT_MS = 8000;

/** A street name Geoclient suggested, and the query that would search for it. */
export interface Suggestion {
  house: string;
  street: string;
  borough: string;
  query: string;
}

export type GeocodeResult =
  | { type: "found"; matches: Found[] }
  | { type: "suggest"; suggestions: Suggestion[] }
  | { type: "none" };

/** The parts of a Geoclient result this file reads. */
interface GeoclientResult {
  status: string;
  request: string;
  response: Record<string, unknown>;
}

const BOROUGHS: Record<string, string> = {
  MANHATTAN: "Manhattan", BRONX: "Bronx", BROOKLYN: "Brooklyn", QUEENS: "Queens",
  "STATEN IS": "Staten Island", "STATEN ISLAND": "Staten Island",
};

/** Ask Geoclient. Throws on a network or HTTP failure, an abort, or a timeout. */
export async function geocode(
  input: string, key: string, signal?: AbortSignal, fetchFn: typeof fetch = fetch,
): Promise<GeocodeResult> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("input", input);
  url.searchParams.set("returnPossiblesWithExact", "true");
  url.searchParams.set("returnRejections", "true");
  // One controller for both the caller's abort and the timeout. (AbortSignal.any would
  // say this in a line, but it is missing from iPhones older than iOS 17.4.)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const forward = () => controller.abort();
  signal?.addEventListener("abort", forward);
  try {
    const resp = await fetchFn(url, {
      headers: { "Ocp-Apim-Subscription-Key": key },
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`Geoclient: HTTP ${resp.status}`);
    return parseGeoclient(await resp.json());
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forward);
  }
}

/** Turn a /search response into matches, suggestions or nothing. */
export function parseGeoclient(body: { results?: GeoclientResult[] }): GeocodeResult {
  const results = body.results || [];
  const matched = results.filter((r) => r.status === "EXACT_MATCH" || r.status === "POSSIBLE_MATCH");
  // Return code 00 is a clean match; 01 is a match with a warning. One warning is
  // "address number altered: range assumed", which is Geoclient moving the house
  // number to make it fit a street: that is how 37-11 74th St lands in Brooklyn as 37
  // 74th St. When any match is clean, the ones with warnings are dropped.
  const clean = matched.filter((r) => r.response.geosupportReturnCode === "00");
  const matches: Found[] = [];
  for (const r of clean.length ? clean : matched) {
    const found = toFound(r);
    if (found && !matches.some((m) => sameSpot(m, found))) matches.push(found);
  }
  if (matches.length) return { type: "found", matches };

  const suggestions: Suggestion[] = [];
  for (const r of results) {
    const s = suggestionFrom(r);
    if (s && !suggestions.some((t) => t.query === s.query)) suggestions.push(s);
  }
  return suggestions.length ? { type: "suggest", suggestions } : { type: "none" };
}

function toFound(r: GeoclientResult): Found | null {
  const p = r.response;
  const lat = Number(p.latitude);
  const lon = Number(p.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return null;
  const borough = BOROUGHS[String(p.firstBoroughName)] || null;
  const center: [number, number] = [lon, lat];
  if (r.request.startsWith("intersection")) {
    return {
      kind: "intersection",
      name: streetName(String(p.firstStreetNameNormalized || p.streetName1 || "")),
      cross: streetName(String(p.secondStreetNameNormalized || p.streetName2 || "")),
      borough, center, bbox: null,
    };
  }
  if (r.request.startsWith("address")) {
    const street = streetName(String(p.firstStreetNameNormalized || ""));
    return {
      kind: "address", name: `${p.houseNumber || ""} ${street}`.trim(), cross: null,
      borough, center, bbox: null,
    };
  }
  // A named place: "yankee stadium", "jfk airport". The preferred name is the full one
  // ("JOHN F KENNEDY AIRPORT"); the normalized one is closer to what was typed.
  if (r.request.startsWith("place")) {
    const name = titleCase(String(p.boePreferredStreetName || p.firstStreetNameNormalized || ""));
    return name ? { kind: "landmark", name, cross: null, borough, center, bbox: null } : null;
  }
  return null;
}

function sameSpot(a: Found, b: Found): boolean {
  return Math.abs(a.center[0] - b.center[0]) < 1e-5 && Math.abs(a.center[1] - b.center[1]) < 1e-5;
}

/** An address rejected for its street name, with a similar name close to what was typed. */
function suggestionFrom(r: GeoclientResult): Suggestion | null {
  if (r.status !== "REJECTED" || !r.request.startsWith("address")) return null;
  const p = r.response;
  const typed = /street=([^,\]]+)/.exec(r.request);
  const house = String(p.houseNumber || p.houseNumberIn || "");
  const borough = BOROUGHS[String(p.firstBoroughName)];
  if (!typed || !house || !borough) return null;
  const want = squash(typed[1]);
  for (let i = 1; i <= 10; i++) {
    const candidate = p[`streetName${i}`];
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    const got = squash(candidate);
    if (editDistance(want, got) <= Math.max(1, Math.floor(want.length / 5))) {
      const street = streetName(candidate);
      return { house, street, borough, query: `${house} ${street}, ${borough}` };
    }
  }
  return null;
}

function squash(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Levenshtein distance. */
export function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

/** "WEST  100 STREET" -> "West 100th Street". */
export function streetName(s: string): string {
  return s.trim().split(/\s+/).filter(Boolean).map((w) => {
    if (/^\d+$/.test(w)) return w + ordinal(Number(w));
    return w.charAt(0) + w.slice(1).toLowerCase();
  }).join(" ");
}

/** "PIER   17" -> "Pier 17": a place name, whose numbers are not ordinals. */
function titleCase(s: string): string {
  return s.trim().split(/\s+/).filter(Boolean)
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(" ");
}

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return "th";
  return ["th", "st", "nd", "rd"][n % 10] || "th";
}
