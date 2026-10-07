# nyc-map-kit

Infrastructure and best practices to create delightful, accessible and very useful digital maps for New Yorkers.

**Demo: <https://cityofnewyork.github.io/nyc-map-kit/app/demo.html>**

## Develop

Needs Node.js 22 (see `.nvmrc`).

```sh
npm ci          # install
npm run dev     # local server that reloads on save: http://localhost:5173/demo.html
npm test        # unit tests for the data logic
npm run lint
npm run build   # type-check, then build the static site, in dist/
```

The code is TypeScript. Vite strips the types without checking them, so `npm run build`
runs the type checker (`tsc`) first, and a type error fails the build here and in CI;
editors show the same errors as you type. The types for the files the app loads
(`config.json`, the point data, `orgs.json`) are in `app/src/logic/types.ts`.

Pushing to `main` publishes the build to GitHub Pages (`.github/workflows/pages.yml`).

The code in `app/src/` is in three layers:

- `core/`: the map (MapLibre, the basemap, pins, camera). No framework, so any page can
  use it.
- `logic/`: the data rules (grouping, sorting, what a card shows). Plain functions,
  unit-tested.
- `ui/`: the interface (list, card, bottom sheet). React.

Per-map settings live in `app/public/config.json`; the data files sit next to it.

## Attribution

Basemap © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, served by
[OpenFreeMap](https://openfreemap.org/). Map rendering by
[MapLibre GL JS](https://maplibre.org/). Geocoding by
[NYC GeoSearch](https://geosearch.planninglabs.nyc/).
