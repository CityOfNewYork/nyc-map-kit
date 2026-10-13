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

The default basemap reads `app/public/nyc.pmtiles`, which is too large for git. To draw it
locally, put the [pmtiles CLI](https://github.com/protomaps/go-pmtiles/releases) on your
`PATH` and run `build/protomaps.sh` once (about 95 MB, five minutes); CI runs it before
each deploy. `?basemap=openfreemap` and `?basemap=nyc` work without it, and
`compare.html` shows any two basemaps side by side.

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
- `ui/`: the interface (search box, list, card, bottom sheet). React.

Per-map settings live in `app/public/config.json`; the data files sit next to it.

## Search

The search box finds boroughs, neighborhoods and ZIP codes in the page, from
`app/public/places.json` (rebuild it with `python3 build/places.py`), and sends anything
else to [NYC Geoclient](https://api-portal.nyc.gov) for addresses, intersections and named
places like Yankee Stadium. It then marks the place, frames it with the nearest sites, and orders the list nearest-first;
no site is ever hidden.

Geoclient needs a subscription key. Copy `app/.env.example` to `app/.env.local`
(git-ignored) and put the key in `VITE_GEOCLIENT_KEY`. The key is compiled into the
JavaScript, so anyone can read it from the published site. Without a key, the box still
finds boroughs, neighborhoods and ZIP codes, and says that is all it finds. The Pages
build reads the key from the repository's Actions secret `VITE_GEOCLIENT_KEY`.

## Attribution

Basemap data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, in
tiles built by [Protomaps](https://protomaps.com/) (the default) or served by
[OpenFreeMap](https://openfreemap.org/); or OTI's NYC Basemap (`?basemap=nyc`). Map rendering by
[MapLibre GL JS](https://maplibre.org/). Site locations geocoded by
[NYC GeoSearch](https://geosearch.planninglabs.nyc/); search by NYC Geoclient. Neighborhood
and borough boundaries from NYC Department of City Planning; ZIP code areas from NYC
Department of Health and Mental Hygiene (MODZCTA), via NYC Open Data.
