import type { MapCore, PointProperties } from "../core/map-core.ts";

/** How many items fit in `room` pixels, from the left, each `widths[i]` wide and `gap`
 *  from the next thing: a row that moves what does not fit into a menu at its end. */
export function itemsThatFit(widths: number[], room: number, gap: number): number {
  let n = 0;
  while (n < widths.length && room >= widths[n] + gap) room -= widths[n++] + gap;
  return n;
}

/** On a desktop the list floats over the map's left edge (see .side in style.css), so
 *  the camera's centre moves right by the list's width plus its 10 px inset either side. */
const LIST_INSET = 10;

/** Keep the camera's centre clear of the list on a desktop. Returns the cleanup. A list
 *  that arrives while the reader is dragging or zooming waits for the gesture to end,
 *  because a camera change would cut it off. `listWidth` is .side's width in CSS.
 *
 *  A list the reader hides (Panel's top line, which marks #panel `shut`) leaves the whole
 *  map clear, and the camera eases over to centre what was in the middle on the wider
 *  view; showing the list again eases it back. */
export function keepClearOfList<P extends PointProperties>(
  map: MapCore<P>, listWidth = 320,
): () => void {
  const raw = map.raw;
  const desktop = matchMedia("(min-width: 768px)");
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  const panel = document.getElementById("panel");
  const left = () =>
    desktop.matches && !panel?.classList.contains("shut") ? listWidth + 2 * LIST_INSET : 0;
  const pad = () => {
    if (raw.isMoving()) {
      raw.once("moveend", pad);
      return;
    }
    raw.setPadding({ left: left() });
  };
  const ease = () => {
    if (raw.isMoving()) {
      raw.once("moveend", ease);
      return;
    }
    if (raw.getPadding().left !== left()) {
      raw.easeTo({ padding: { left: left() }, duration: still.matches ? 0 : 300 });
    }
  };
  pad();
  desktop.addEventListener("change", pad);
  const shut = new MutationObserver(ease);
  if (panel) shut.observe(panel, { attributeFilter: ["class"] });
  return () => {
    desktop.removeEventListener("change", pad);
    shut.disconnect();
    raw.off("moveend", pad);
    raw.off("moveend", ease);
  };
}
