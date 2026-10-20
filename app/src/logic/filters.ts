/**
 * filters.ts — which organization types the reader has asked to see.
 *
 * A filter hides the same sites from the list and the map, and lives in the address bar
 * so a copied link carries it: ?type=Nonprofit&type=Government+Agency, one `type` per
 * organization type, as the data spells it. No types named means every type.
 */
import type { Site } from "./types.ts";

/** Each organization type in `features`, most sites first, with how many it has. */
export function orgTypes(features: Site[]): { type: string; count: number }[] {
  return valuesByCount(features, "org_type");
}

/** Each value of property `key` in `features`, most sites first, with how many it has. */
export function valuesByCount(features: Site[], key: string): { type: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const f of features) {
    const type = (f.properties as unknown as Record<string, unknown>)[key];
    if (typeof type === "string" && type) counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return [...counts].map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

export function typesFromUrl(search: string): string[] {
  return new URLSearchParams(search).getAll("type").filter(Boolean);
}

/** `url` with `types` written into it in place of any there before. */
export function withTypes(url: URL, types: string[]): URL {
  const out = new URL(url);
  out.searchParams.delete("type");
  for (const type of types) out.searchParams.append("type", type);
  return out;
}

/** The sites of `types`, or every site when none are named. */
export function ofTypes(features: Site[], types: string[]): Site[] {
  return types.length
    ? features.filter((f) => types.includes(f.properties.org_type ?? ""))
    : features;
}
