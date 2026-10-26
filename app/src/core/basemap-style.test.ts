import { expect, test } from "vitest";
import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import { addSubwayStations, greyOutsideCity, hideLabelsOutsideCity } from "./basemap-style.ts";
import { STATION_ICON } from "./station-icon.ts";

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

test("draw the subway's stations from the MTA's file as the top layer, named from z14", () => {
  const s = addSubwayStations(addSubwayStations(style()));
  expect(s.sources.subway).toMatchObject({ type: "geojson", data: "subway-stations.geojson" });
  expect(JSON.stringify(s.sources.subway)).toMatch(/Subway stations: .*MTA/);
  expect(s.layers.filter((l) => l.id === "subway_station")).toHaveLength(1);
  const stations = s.layers.at(-1)!;
  expect(stations).toMatchObject({ id: "subway_station", minzoom: 13 });
  expect(stations.layout).toMatchObject({
    "icon-image": STATION_ICON, "text-optional": true,
    "text-field": ["step", ["zoom"], "", 14, ["get", "name"]],
  });
});
