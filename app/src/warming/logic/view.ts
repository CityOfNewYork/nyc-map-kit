export type View = "landing" | "map";

export function viewFromUrl(search: string): View {
  return new URLSearchParams(search).get("view") === "map" ? "map" : "landing";
}
