import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { normalize, placeMatcher } from "./places.ts";
import type { PlacesDoc } from "./places.ts";

const doc: PlacesDoc = JSON.parse(
  readFileSync(new URL("../../public/places.json", import.meta.url), "utf8"));
const match = placeMatcher(doc);

describe("normalize", () => {
  test("drops apostrophes and punctuation", () => {
    expect(normalize("Hell's  Kitchen, NY")).toBe("hells kitchen ny");
    expect(normalize("Bedford-Stuyvesant")).toBe("bedford stuyvesant");
  });
});

describe("placeMatcher", () => {
  test("neighborhoods, with their borough", () => {
    expect(match("Harlem")).toMatchObject({ kind: "nbhd", name: "Harlem", borough: "Manhattan" });
    expect(match("astoria, queens ny")).toMatchObject({ kind: "nbhd", name: "Astoria" });
    expect(match("Bed-Stuy")).toMatchObject({ kind: "nbhd", borough: "Brooklyn" });
  });

  test("the longer name wins", () => {
    expect(match("East Harlem")).toMatchObject({ name: "East Harlem" });
    expect(match("Manhattan Beach")).toMatchObject({ kind: "nbhd", borough: "Brooklyn" });
  });

  test("boroughs", () => {
    expect(match("The Bronx")).toMatchObject({ kind: "borough", name: "Bronx", borough: null });
    expect(match("staten island")).toMatchObject({ kind: "borough", name: "Staten Island" });
  });

  test("ZIP codes, including one that shares an area with another", () => {
    expect(match("10027")).toMatchObject({ kind: "zip", name: "10027" });
    expect(match("10118")!.center).toEqual(match("10001")!.center);
    expect(match("10027 Manhattan")).toMatchObject({ kind: "zip" });
  });

  test("the most specific place wins", () => {
    expect(match("Harlem, Manhattan")).toMatchObject({ kind: "nbhd", name: "Harlem" });
  });

  test("anything left over is an address, not a place", () => {
    expect(match("120 Broadway")).toBeNull();
    expect(match("Flatbush Ave Brooklyn")).toBeNull();
    expect(match("99999")).toBeNull();
    expect(match("10027 10030")).toBeNull();
    expect(match("   ")).toBeNull();
  });

  test("every place has a point inside its box", () => {
    for (const group of [doc.boroughs, doc.nbhds, doc.zips]) {
      for (const e of Object.values(group)) {
        const [w, s, east, n] = e.bb;
        expect(w < east && s < n).toBe(true);
        expect(e.c[0] >= w && e.c[0] <= east && e.c[1] >= s && e.c[1] <= n).toBe(true);
      }
    }
  });
});
