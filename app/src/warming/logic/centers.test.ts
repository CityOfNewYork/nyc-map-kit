import { describe, expect, test } from "vitest";
import type { Site } from "../../logic/types.ts";
import { CENTER_KINDS, CENTER_PINS, centerKind, centerStatus } from "./centers.ts";

function center(properties: Record<string, unknown>): Site {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [-73.9, 40.8] },
    properties: { id: "c1", org: "Center", org_id: "c1", ...properties } as Site["properties"],
  };
}

describe("centerKind", () => {
  test("is the kind its type names", () => {
    expect(centerKind(center({ type: "hospital" }))?.label).toBe("Hospital");
  });
  test("is undefined for a type not listed, or none", () => {
    expect(centerKind(center({ type: "library" }))).toBeUndefined();
    expect(centerKind(center({}))).toBeUndefined();
  });
});

describe("CENTER_PINS", () => {
  test("gives each kind a pin in its own colour and glyph, read from `type`", () => {
    expect(CENTER_PINS.field).toBe("type");
    for (const [type, { color, glyph }] of CENTER_KINDS) {
      expect(CENTER_PINS.values[type]).toEqual({ color, glyph });
    }
    expect(Object.keys(CENTER_PINS.values)).toEqual([...CENTER_KINDS.keys()]);
  });
});

describe("centerStatus", () => {
  test("reads the center's own hours", () => {
    const overnight = center({ opens: "22:00", closes: "05:00" });
    expect(centerStatus(overnight, 23 * 60)).toEqual({ state: "open", until: 300 });
    expect(centerStatus(center({}), 0)).toBeNull();
  });
});
