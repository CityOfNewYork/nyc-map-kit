# nyc-map-kit

A **basic embedded map**: framework-free, no build step, dropped into any page with one
`<iframe>`. It is meant to be the first of several building blocks for city maps — the one
every map needs before it needs anything else, so the next map starts here instead of at
zero. It is exercised here on 185 SNAP volunteer service sites run by 75 organizations
across New York City, the dataset behind the
[ABAWD volunteering page](https://www.nyc.gov/main/services/snap-benefits/abawd).

**Demo: <https://cityofnewyork.github.io/nyc-map-kit/>**

## Status and provenance

**This is a prototype, not a City service.** It is published so the approach can be
reviewed and adapted. It is not operated, monitored or supported, it has not been through
accessibility or security review, and nothing here is an official source of information
for New Yorkers.

**The data is a dated snapshot and is not authoritative.** It is a hand export of the SNAP
Employment and Training volunteer site list taken in September 2026. Locations come from
geocoding street addresses, so a pin is only as good as the address string it came from —
a handful resolve to the wrong building, and there is no production data feed behind this.
The authoritative version is whatever the ABAWD volunteering page links to today. Anyone
relying on a specific site should confirm it with the organization.

## Run it

```sh
cd app && python3 -m http.server 8000
```

- <http://localhost:8000/demo.html> — the block embedded at two sizes
- <http://localhost:8000/embed.html> — the block on its own
- add `?lang=es` to either for the basemap in Spanish

Every URL inside `app/` is relative so the same files work at a domain root and under a
GitHub Pages subpath. **Keep them relative.** Pages serves this repository from the root of
`main`; `.nojekyll` turns off Jekyll.

Note when measuring rather than developing: `http.server` does not gzip, so the JSON goes
over the wire at roughly four times its real size.

## Embed it

```html
<iframe src="embed.html?list=on"
        title="Map of SNAP volunteer opportunities"
        style="width:100%;height:640px;border:0"></iframe>
```

The block fills whatever box you give it and never sets its own size. The host page's only
job is the iframe's dimensions and its `title`.

| Parameter | Values | Default | What it does |
|---|---|---|---|
| `data` | relative URL | `sites.geojson` | GeoJSON FeatureCollection of points. Same-origin only. |
| `orgs` | relative URL | `orgs.json` | Per-organization records joined on `org_id`. Optional. |
| `list` | `on` \| `off` | `on` | The list panel / bottom sheet. |
| `lang` | BCP-47 subtag | `<html lang>`, else `en` | Basemap label language. |
| `title` | string | from `config.json` | The block's `<h1>`. In the DOM, visually hidden. |

`data` and `orgs` are restricted to the block's own origin — anyone can iframe this page
with any query string, and without that restriction the embed is a content proxy.

**`app/config.json` is the only file you edit to point the block at a different dataset.**
It decides what the card shows: `actions` is the button row under the address (call,
website, open in maps), `card` is the labelled detail below it, each entry naming a field
and whether to read it from the feature (`site`) or the organization record (`org`).

## Rebuild the data

```sh
python3 build/build.py
```

Stdlib Python 3 only. Reads `data/source-2026-09.kml`, falling back to the committed
`data/sevsp-2026-09.csv`; `read_kml()` and `read_csv()` are adapters, so a third source is
a third reader and nothing else changes. Writes `app/sites.geojson` (identity and
site-level fields), `app/orgs.json` (the long prose, once per organization rather than per
site — the split is what keeps the payload small), and the sanitized CSV.

**The CSV is the committed source of truth.** The raw KML and spreadsheet carry contact
names and personal email addresses; those three columns are dropped by the pipeline and the
raw files are gitignored. A clean clone rebuilds byte-identically from the CSV alone.

**Geocoding.** Addresses resolve through overrides → cache →
[NYC GeoSearch](https://geosearch.planninglabs.nyc/) (DCP Planning Labs' hosted Pelias; no
key, NYC-authoritative). The source carries no coordinates at all, so the first thing this
pipeline produces is the city's own copy of its own coordinates. `data/overrides.json` is
consulted first, so a hand fix survives a rebuild and a cache wipe. If fewer than 95% of
addresses resolve the build prints the failures and exits without writing.

**Known imprecision.** `build.py` takes the first Pelias result without checking
`match_type`, and Pelias answers a house number it does not hold with a different building
on the same street — a plausible pin rather than an error. A one-off cross-check against the
US Census geocoder found four pins disagreeing by more than 300 m, each traceable to the
address string rather than the engine: a suite number in the house-number field, a
misspelled street, a missing ZIP, a house number that does not exist. One row is an
organization outside New York City with a NYC borough entered in the source. Gating on
`match_type` and filtering out-of-city rows is the fix and **it is not done**. Re-run the
cross-check on any new extract; it is the only cheap check that catches a confident wrong
answer.

Source data is hand-maintained and carries what hand-maintained spreadsheets carry,
including one editing note that has become an organization name. **The pipeline does not
silently correct any of it** — cleaning a record in the build leaves the source wrong and
hides that it is wrong. Suppress a record in an explicit normalization table in `build.py`
if you must, never by hand-editing the generated files.

## Using map-core in a finder

`map-core.js` is the reusable half: MapLibre setup, selection, highlight, clustering, the
live region. `embed.js` is its first client and deliberately thin. A finder should **not**
iframe this app — its list and map share too much state to sit across a `postMessage`
boundary. It should import the core:

```js
import { createMap } from "./map-core.js";

const map = createMap(el, { style, data, onSelect(feature, { via }) { … } });
map.setData(geojson);   // after a search or filter
map.select(id);         // null to clear
map.highlight(ids);     // emphasize a subset; [] clears
map.fitTo(ids);
map.destroy();
```

`id` is the `id` **property** of a feature, not MapLibre's internal numeric id.

Extract this into a versioned package when there is a second consumer, not before.

## Decisions worth knowing before you change things

The reasoning behind each of these is in the code comments, next to the code it constrains.

- **A card is always exactly one record**, from a pin and from the list alike. Anything
  that moves you to a different record is chrome around the card, never content inside it.
  Records within 25 m share a card through a counted stepper.
- **Clustering is off** (`createMap(el, { cluster: true })` turns it on). At this scale the
  shape of the data still reads; a count bubble also puts text on canvas where neither a
  screen reader nor the translation proxy can reach it.
- **The list is the map's text alternative**, not a finder: 185 rows, one per site, ordered
  north to south, no search or filters. `list=off` assumes the host page carries the same
  information in text — if it does not, the result is not an accessible page.
- **No string files and no i18n library.** nyc.gov is translated by a proxy that rewrites
  DOM text nodes, so every visible string is a text node in its own element, no visible
  text lives in an attribute, and nothing is built by concatenation. The basemap is the
  exception — its labels are drawn to canvas, so `basemap-style.js` switches them itself.
  **This requires being served from a hostname the proxy covers.**
- **No build toolchain.** MapLibre 6.8.0 as an ES module; v6 has no UMD build and no
  default export, so `import * as maplibregl` is required.

## Known gaps

1. **Self-host the basemap.** The demo runs on OpenFreeMap's hosted `positron`, keyless and
   unmetered, with a warm tint applied at load. A free tier is a term of service, not an
   architecture. The intended production basemap is a Protomaps PMTiles extract on blob
   storage — one static file, no external runtime. The swap is confined to
   `basemap-style.js`.
2. **Payload.** The application is 83 KB; the page is about 1.5 MB, because a hosted planet
   basemap ships ~1.16 MB of tiles, sprites and glyphs for New York. That is the number the
   extract in (1) moves, and the reason not to quote total page weight as a win.
3. **Self-host MapLibre** and the sprites and glyphs, to remove the last CDN from the
   runtime.
4. **Wire the analytics transport.** The block pushes `map_load`, `map_pin_open`,
   `map_action_click` and `map_open_in_maps_click` to `window.dataLayer` inside the iframe.
   Which tag to send them to, and whether to `postMessage` them to the host instead, is open.
5. **A screen-reader pass** and sign-off on the list-as-text-alternative pattern. Keyboard
   operation has been walked end to end; VoiceOver and NVDA have not.
6. **A scheduled data feed** and an identified owner for it on the agency side. The pipeline
   is ready for either a CSV drop or a warehouse export; the feed does not exist, which is
   why the data here is a snapshot with a date on it.
7. **Design tokens.** Colours are declared once at the top of `style.css`, and the pin
   colours once at the top of `map-core.js` because MapLibre paints them to canvas. Agree
   the token names with the city's design system before a second map copies these.
8. **`window.nycMapKit`** is exposed as a console handle for this prototype. Decide
   deliberately whether it belongs in production.

## Attribution

Basemap © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, served by
[OpenFreeMap](https://openfreemap.org/). Map rendering by
[MapLibre GL JS](https://maplibre.org/). Geocoding by
[NYC GeoSearch](https://geosearch.planninglabs.nyc/).
