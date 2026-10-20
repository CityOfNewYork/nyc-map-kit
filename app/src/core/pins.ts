/**
 * pins.ts — the stock of pin colours and marks a map's categories take, in order.
 *
 * The first three are the City's child care finder's (finder.nyc.gov/childcarenyc): its
 * colours, and the white marks in its pins' heads. The next two are drawn in the same
 * family. A map with more categories than the stock shows the rest in PIN_OTHER.
 *
 * Each mark is SVG path data on map-core's 24-unit glyph square, filled white, sized to
 * fill as much of the head as the child care finder's do.
 */
import type { PinCategories } from "./map-core.ts";

export interface PinStyle {
  color: string;
  /** A solid mark; none draws the default pin's hole. */
  glyph?: string;
}

export const PIN_STOCK: PinStyle[] = [
  { color: "#f38600", glyph: "M1.6 12a10.4 10.4 0 1 0 20.8 0a10.4 10.4 0 1 0 -20.8 0Z" },  // circle
  { color: "#348563", glyph: "M3.1 3.1h17.8v17.8H3.1Z" },                                   // square
  { color: "#6460a6",                                                                       // star
    glyph: "M12 0.9L15.3 8.1L23.1 9L17.3 14.3L18.9 22.1L12 18.2L5.1 22.1L6.7 14.3L0.9 9L8.7 8.1Z" },
  { color: "#c1507a", glyph: "M12 1.8L22.2 19.6H1.8Z" },                                    // triangle
  { color: "#0080b2", glyph: "M12 1.2L22.8 12L12 22.8L1.2 12Z" },                           // diamond
];

/** Every category past the stock: grey, with the plain hole. */
export const PIN_OTHER: PinStyle = { color: "#6b6b6b" };

/** The pin style of each of `values`, in order: the stock, then PIN_OTHER. */
export function stockStyles(values: string[]): Map<string, PinStyle> {
  return new Map(values.map((value, i) => [value, PIN_STOCK[i] ?? PIN_OTHER]));
}

/** The categories map-core draws for `field`, from stockStyles. */
export function stockCategories(field: string, styles: Map<string, PinStyle>): PinCategories {
  return {
    field,
    values: Object.fromEntries(
      [...styles].map(([value, { color, glyph }]) => [value, { color, glyph, fill: true }])),
  };
}
