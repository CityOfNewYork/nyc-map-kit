import { describe, expect, test } from "vitest";
import { PIN_OTHER, PIN_STOCK, stockCategories, stockStyles } from "./pins.ts";

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
