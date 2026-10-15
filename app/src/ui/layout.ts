import type { MapCore, PointProperties } from "../core/map-core.ts";

/** On a desktop the list floats over the map's left edge (see .panel in style.css), so
 *  the camera's centre moves right by the list's width plus its 10 px inset either side. */
const LIST_PADDING = 340;

/** Keep the camera's centre clear of the list on a desktop. Returns the cleanup. */
export function keepClearOfList<P extends PointProperties>(map: MapCore<P>): () => void {
  const desktop = matchMedia("(min-width: 768px)");
  const pad = () => map.raw.setPadding({ left: desktop.matches ? LIST_PADDING : 0 });
  pad();
  desktop.addEventListener("change", pad);
  return () => desktop.removeEventListener("change", pad);
}
