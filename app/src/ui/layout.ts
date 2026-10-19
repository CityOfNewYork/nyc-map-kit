import type { MapCore, PointProperties } from "../core/map-core.ts";

/** On a desktop the list floats over the map's left edge (see .panel in style.css), so
 *  the camera's centre moves right by the list's width plus its 10 px inset either side. */
const LIST_PADDING = 340;

/** Keep the camera's centre clear of the list on a desktop. Returns the cleanup. A list
 *  that arrives while the reader is dragging or zooming waits for the gesture to end,
 *  because a camera change would cut it off. */
export function keepClearOfList<P extends PointProperties>(map: MapCore<P>): () => void {
  const raw = map.raw;
  const desktop = matchMedia("(min-width: 768px)");
  const pad = () => {
    if (raw.isMoving()) {
      raw.once("moveend", pad);
      return;
    }
    raw.setPadding({ left: desktop.matches ? LIST_PADDING : 0 });
  };
  pad();
  desktop.addEventListener("change", pad);
  return () => {
    desktop.removeEventListener("change", pad);
    raw.off("moveend", pad);
  };
}
