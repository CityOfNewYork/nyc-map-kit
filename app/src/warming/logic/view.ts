export type View = "landing" | "map";

/** The map view for ?view=map, and for a link to one center's card (?site=). */
export function viewFromUrl(search: string): View {
  const params = new URLSearchParams(search);
  return params.get("view") === "map" || params.has("site") ? "map" : "landing";
}
