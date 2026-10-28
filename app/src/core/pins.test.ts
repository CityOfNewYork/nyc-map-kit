import { describe, expect, test } from "vitest";
import { PIN_OTHER, PIN_STOCK, stockCategories, stockStyles } from "./pins.ts";

/** The area a mark's path data covers: a circle drawn as two arcs, or a polygon. */
function area(glyph: string): number {
  const arc = /a([\d.]+)/.exec(glyph);
  if (arc) return Math.PI * Number(arc[1]) ** 2;
  const points: [number, number][] = [];
  let [x, y] = [0, 0];
  for (const [, command, args] of glyph.matchAll(/([MLHVhvZ])([^MLHVhvZ]*)/g)) {
    const n = args.trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (command === "M" || command === "L") [x, y] = n;
    else if (command === "H") x = n[0];
    else if (command === "V") y = n[0];
    else if (command === "h") x += n[0];
    else if (command === "v") y += n[0];
    else continue;   // Z
    points.push([x, y]);
  }
  return Math.abs(points.reduce((sum, [x1, y1], i) => {
    const [x2, y2] = points[(i + 1) % points.length];
    return sum + x1 * y2 - x2 * y1;
  }, 0)) / 2;
}

describe("PIN_STOCK", () => {
  const white = PIN_STOCK.map(({ glyph }) => area(glyph!) / 24 ** 2);
  test("no mark covers more than 40% of its square in white", () => {
    for (const share of white) expect(share).toBeLessThanOrEqual(0.4);
  });
  test("the circle, the square and the diamond are drawn at 40%", () => {
    expect([white[0], white[1], white[4]].map((share) => share.toFixed(2)))
      .toEqual(["0.40", "0.40", "0.40"]);
  });
});

describe("stockStyles", () => {
  test("gives the values the stock's styles in order, then PIN_OTHER", () => {
    const values = ["a", "b", "c", "d", "e", "f", "g"];
    const styles = stockStyles(values);
    expect([...styles.keys()]).toEqual(values);
    expect([...styles.values()]).toEqual([...PIN_STOCK, PIN_OTHER, PIN_OTHER]);
  });
  test("each stock style is its own colour", () => {
    expect(new Set(PIN_STOCK.map((s) => s.color)).size).toBe(PIN_STOCK.length);
  });
});

describe("stockCategories", () => {
  test("draws each value in its style, as a filled pin, read from `field`", () => {
    const categories = stockCategories("org_type", stockStyles(["Nonprofit", "Library"]));
    expect(categories).toEqual({
      field: "org_type",
      values: {
        Nonprofit: { color: PIN_STOCK[0].color, glyph: PIN_STOCK[0].glyph, fill: true },
        Library: { color: PIN_STOCK[1].color, glyph: PIN_STOCK[1].glyph, fill: true },
      },
    });
  });
});
