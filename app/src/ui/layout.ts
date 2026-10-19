import type { MapCore, PointProperties } from "../core/map-core.ts";

/** On a desktop the list floats over the map's left edge (see .side in style.css), so
 *  the camera's centre moves right by the list's width plus its 10 px inset either side. */
const LIST_INSET = 10;

/** Keep the camera's centre clear of the list on a desktop. Returns the cleanup. A list
 *  that arrives while the reader is dragging or zooming waits for the gesture to end,
 *  because a camera change would cut it off. `listWidth` is .side's width in CSS. */
export function keepClearOfList<P extends PointProperties>(
  map: MapCore<P>, listWidth = 320,
): () => void {
  const raw = map.raw;
  const desktop = matchMedia("(min-width: 768px)");
  const pad = () => {
    if (raw.isMoving()) {
      raw.once("moveend", pad);
      return;
    }
    raw.setPadding({ left: desktop.matches ? listWidth + 2 * LIST_INSET : 0 });
  };
  pad();
  desktop.addEventListener("change", pad);
  return () => {
    desktop.removeEventListener("change", pad);
    raw.off("moveend", pad);
  };
}
