import { expect, test } from "vitest";
import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import { greyOutsideCity, hideLabelsOutsideCity } from "./basemap-style.ts";

const style = (): StyleSpecification => ({
  version: 8,
  sources: { tiles: { type: "vector", url: "https://example.test/tiles.json" } },
  layers: [
    { id: "land", type: "fill", source: "tiles", "source-layer": "earth" },
    { id: "water", type: "fill", source: "tiles", "source-layer": "water" },
    { id: "towns", type: "symbol", source: "tiles", "source-layer": "places",
      filter: ["==", "kind", "town"] },
    { id: "shields", type: "symbol", source: "tiles", "source-layer": "roads" },
  ] as LayerSpecification[],
});

test("grey the land outside the city directly under the water", () => {
  const ids = greyOutsideCity(style(), "water").layers.map((l) => l.id);
  expect(ids.slice(0, 3)).toEqual(["land", "outside_city", "water"]);
});

test("show labels only inside the city, except the ones kept", () => {
  const layers = hideLabelsOutsideCity(style(), "tiles", (l) => l.id === "shields").layers;
  const layer = (id: string) => layers.find((l) => l.id === id);
  // The layer's own legacy filter, converted, and the test for the city.
  const towns = layer("towns");
  expect(towns && "filter" in towns && towns.filter)
    .toEqual(["all", ["==", ["get", "kind"], "town"], ["within", expect.anything()]]);
  expect(layer("shields")).not.toHaveProperty("filter");
});
