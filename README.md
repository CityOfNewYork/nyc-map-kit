# nyc-map-kit

## What this is

A **basic embedded map**: a framework-free, no-build web component you drop into any page
with an `<iframe>`. It is meant to be the first of several building blocks for city maps —
the one every map needs before it needs anything else, so that the next map starts here
instead of at zero. This repository proves it on 185 SNAP volunteer service sites run by
75 organizations across New York City, the dataset behind the
[ABAWD volunteering page](https://www.nyc.gov/main/services/snap-benefits/abawd), which
today points residents at a Google My Map.

The code is written to be read and adapted, not just run. If you are the engineer who is
going to own the production version, this README is the handoff and the rest of this file
is addressed to you.

---

## Run it

No install step, no build step, no server code.

```sh
cd app
python3 -m http.server 8000
```

Then open:

| | |
|---|---|
| <http://localhost:8000/demo.html> | a mock host page with the block embedded twice |
| <http://localhost:8000/embed.html> | the block on its own |
| <http://localhost:8000/demo.html?lang=es> | the same page with the basemap in Spanish |

Any static file server will do — the app never issues a Range request and never needs a
rewrite rule.

Every URL inside `app/` is relative, so the same files work unchanged at
`http://localhost:8000/` and under a GitHub Pages project subpath
(`https://<account>.github.io/nyc-map-kit/`). **Keep them relative.** A single leading
slash anywhere in `app/` breaks the subpath deployment and nothing else, which makes it an
expensive mistake to find later.

One caveat if you are *measuring* rather than developing: `python3 -m http.server` does not
gzip, so `sites.geojson` and `orgs.json` go over the wire at four times their real size.
Benchmark against a server that compresses, or the payload numbers mean nothing.

---

## Rebuild the data

```sh
python3 build/build.py
```

Stdlib Python 3 only. It prints what it did:

```
read 185 rows from data/source-2026-09.kml
wrote data/sevsp-2026-09.csv (sanitized; 15 columns, contact person/title/email dropped)

  sites        185
  orgs         75
  resolved     185 / 185  (100.0%)
  from cache   184
  geocoded     0
  overrides    1
  generated    2026-09-14
```

### What it reads

`build.py` prefers `data/source-2026-09.kml` (the export of the Google My Map, which is
the richer source) and falls back to `data/sevsp-2026-09.csv`. Both go through a thin
reader function and produce the same list of dicts; everything after that is
source-agnostic. When this data starts arriving as a Snowflake export, add a third reader
and change nothing else.

**The CSV is the committed source of truth.** The KML and the original spreadsheet carry
contact names and personal email addresses, so they are gitignored; the pipeline writes a
sanitized CSV with those three columns dropped, and a clean clone with no KML rebuilds
from that alone. The excluded columns are `Primary Contact Person`,
`Primary Contact Title/Role`, and `Email Address` — they are on the public My Map today,
but a downloadable file is a different surface from a pin someone has to click, and the
card shows phone and website instead.

Verified: moving the KML out of the way and rebuilding from the CSV alone produces a
`sites.geojson` **byte-identical** to the KML build.

### What it writes

| File | What it is |
|---|---|
| `app/sites.geojson` | 185 Point features. Identity and site-level fields only. |
| `app/orgs.json` | 75 organizations, each with its sites and the long prose. |
| `app/one-site.geojson` | One feature, for the single-point demo iframe. |
| `data/sevsp-2026-09.csv` | The sanitized flat file described above. |
| `data/geocode_cache.json` | Appended to, never rewritten from scratch. |

The split between the two app files is a payload decision, not a modelling one. Acacia
Housing and Preservation has 60 sites and the same paragraph of program description on
every one of them; carrying that per-feature put `sites.geojson` at 272 KB. Moving the
five long prose fields into `orgs.json` — once per organization — brings it to 99 KB
(15 KB gzipped) and `embed.js` joins the two on `org_id`.

### Geocoding

There are **no coordinates in the source at all** — zero `<Point>` elements in 185
placemarks. Google geocodes the addresses at render time and keeps the result. So the
first thing the city gets out of this pipeline is its own copy of its own coordinates.

Each address goes through, in order: **overrides → cache → GeoSearch → cache.**

- **[NYC GeoSearch](https://geosearch.planninglabs.nyc/)** (`/v2/search?size=1&text=…`) is
  DCP Planning Labs' hosted Pelias. Free, no key, no quota, NYC-authoritative. The build
  waits ~120 ms between calls.
- `data/geocode_cache.json` is keyed by the raw address string, so a rebuild costs zero
  network calls. Delete it to re-resolve everything.
- `data/overrides.json` is consulted **first**, so a hand fix survives both a rebuild and
  a cache wipe. Two forms:
  ```json
  { "<raw address>": { "query": "different text to ask GeoSearch" } }
  { "<raw address>": { "lon": -73.91513, "lat": 40.81403, "note": "why" } }
  ```

**The 95% gate.** If fewer than 95% of addresses resolve, the build prints the unresolved
list and exits 1 without writing anything. A bad input file should stop the pipeline, not
quietly ship a half-empty map. Change `MIN_RESOLVED` in `build/build.py` to move the bar.

**The two addresses that need overrides** (both are in `data/overrides.json` with their
reasons):

1. `Salvation Army Harlem Temple, 540 Malcolm X Blvd at West 138th Street…` — a venue name
   plus a cross-street defeats the geocoder. Re-asked as `540 Malcolm X Blvd, New York, NY
   10037`, which resolves.
2. `Brooke Ave between East 147th Street and East 148th Street, Bronx, NY 10455` — two
   problems. The street is *Brook* Avenue, and the address names a block rather than a
   point. **Pelias does not resolve intersections at all**, so no amount of rephrasing
   helps: every intersection form returns zero features. Hand-placed at 510 Brook Avenue,
   the mid-block addressed point between the two cross streets. (City Relief runs mobile
   outreach on that block, so block-level precision is the honest answer anyway.)

With both overrides in place the build resolves **185 / 185**.

### A data-quality note you will hit immediately

The source has a 75th "organization" named
`Acacia Housing and Preservation 3-64 Column P udated`, with one site. It is a note
somebody typed into the organization-name column of the source spreadsheet, typo included,
and it is live on the public My Map right now. The pipeline does not silently correct it:
the map should show what the data says, and a visible wrong record is how the data gets
fixed at the source. If you need it gone before the source is fixed, the right place is a
name-normalization table in `build.py`, not a hand edit of `orgs.json`.

---

## Embed contract

```html
<iframe src="embed.html?list=on"
        title="Map of SNAP volunteer opportunities"
        style="width:100%;height:640px;border:0"></iframe>
```

The block fills whatever box you give it (`html, body, #root { height: 100% }`) and never
sets its own size. The host page's only job is the iframe's dimensions and its `title`.

| Parameter | Values | Default | What it does |
|---|---|---|---|
| `data` | relative URL | `sites.geojson` | The GeoJSON FeatureCollection of points. Must be same-origin (see below). |
| `orgs` | relative URL | `orgs.json` | Organization records. If it 404s, the block groups the features by their `org` property instead and the card shows only what the features carry. Organizations and sites not present in `data` are dropped, so the counts and the list always describe what is actually on the map. |
| `list` | `on` \| `off` | `on` | The list panel / bottom sheet. `off` when the host page already carries the content in text. |
| `lang` | BCP-47 subtag | `<html lang>`, else `en` | Basemap label language. See §Language notes. |
| `title` | string | `config.json`'s `title` | The heading inside the block. |

`data` and `orgs` are **restricted to the block's own origin.** Anyone can iframe this page
with any query string, so without that restriction the embed is a content proxy: a third
party could point it at their own GeoJSON and have a city page render their text. A
cross-origin value is ignored with a console warning and the default is used.

The two iframes on `demo.html` are the worked examples:

```html
<iframe src="embed.html?list=on"></iframe>
<iframe src="embed.html?list=off&data=one-site.geojson&title=Henry%20Street%20Settlement"></iframe>
```

### What the card shows

`app/config.json` decides, and it is the only file you edit to point the block at a
different dataset. Each entry names a field, where to read it from (`site` = the GeoJSON
feature's properties, `org` = the matching record in `orgs.json`), its label, and
optionally how to render it (`tel`, `url`).

```json
{ "key": "phone", "source": "site", "label": "Phone", "as": "tel" }
```

`"directions": false` removes the Directions button. The Directions link is a plain deep
link — `https://www.google.com/maps/dir/?api=1&destination=<lat>,<lon>` — which opens the
resident's own maps app. No SDK, no API key, no billing account, no third-party script on
the page.

---

## Events

The block pushes to `window.dataLayer` inside the iframe and logs every push to the console.

| Event | Payload | When |
|---|---|---|
| `map_load` | `{sites, orgs, lang}` | Map style and layers are up. |
| `map_pin_open` | `{org_id, site_id, via}` | A site is selected. `via` is `map`, `list`, or `chooser`. |
| `map_list_expand` | `{org_id, sites}` | A multi-site organization is expanded in the list. |
| `map_cluster_expand` | `{count}` | A cluster bubble is clicked. |
| `map_directions_click` | `{org_id, site_id}` | The Directions button is used. |

**Wiring this up is not done.** `dataLayer` is the iframe's own window, so the host page's
tag does not see it. Two ways out: put the tag inside the block too (simplest, and what
nyc.gov's finder apps do today), or have the block `postMessage` events to the host and let
the host push them. The prototype does neither on purpose — which tag nyc.gov runs is an
open question for the analytics owner, and the answer changes which of those two is right.
Everything above the push is done; the transport is one function.

---

## Swapping a layer

Every layer is independently replaceable. That is the point of the block, so here is where
each swap actually lands.

### Basemap: OpenFreeMap → Protomaps on Azure blob

Today the demo runs on [OpenFreeMap](https://openfreemap.org/)'s hosted `positron` style —
keyless OpenMapTiles vector tiles, no account, no metering, the same basemap the Medicaid
demo has run on since 2026-09-10.

**That is a demo choice, not the production plan.** A keyless free tier is a term of
service, not an architecture: CARTO's basemaps were keyless until August 2026 and then
weren't. The intended production basemap is **Protomaps PMTiles self-hosted on Azure
blob** — one static file next to the app, no external runtime dependency, nothing to page
about at 2 a.m. That is an infrastructure decision to be made with the platform team at
handoff, not something this prototype should presume.

The extract, for reference:

```sh
pmtiles extract https://build.protomaps.com/<build>.pmtiles nyc.pmtiles \
  --bbox=-74.30,40.47,-73.65,40.95
```

The swap is confined to `app/basemap-style.js` plus loading the `pmtiles` protocol script.
Nothing else in the app changes: `map-core.js` takes a style object and does not care where
it came from, and the label-language rewrite in `setStyleLanguage()` works on any
OpenMapTiles-schema style, self-hosted or not.

### Map engine

MapLibre GL JS is pinned at **6.8.0**, loaded as an ES module from jsDelivr. Two things to
know about v6 if you go to change the version:

- **There is no UMD build any more.** `dist/maplibre-gl.js` does not exist in v6; only
  `.mjs`. The `<script src>`-and-a-global pattern you will find in every older example
  (including the Medicaid demo, on 4.7.1) does not work. Native `import` is the no-build
  path now.
- **There is no default export.** `import maplibregl from …` fails silently at module
  evaluation; it has to be `import * as maplibregl from …`.

If either bites, the last 5.x (`5.24.0`) still ships the UMD build and works with this code
after changing the import to a `<script>` tag and a global. The version delta over the wire
is about 10 KB.

For production, **self-host the library** next to the app rather than pulling it from a
CDN. It removes the last third-party runtime dependency and it is one file to copy.

### Geocoder: GeoSearch ↔ geoclient

`geosearch()` in `build/build.py` is eight lines and the only place the geocoder appears.
GeoSearch (hosted Pelias, no key) is the default; OTI's own geoclient wrapper around
GeoSupport returns a richer payload — BBL, BIN, community district, census tract — and is
the better choice if the map ever needs to join to anything parcel-shaped. Swapping means
rewriting that one function to return `(lon, lat, label)`. The cache format does not
change, but delete the cache when you switch so the two geocoders' results don't mix.

### Data: KML ↔ CSV ↔ Snowflake

`read_kml()` and `read_csv()` are adapters. Add `read_snowflake_export()` next to them,
return the same dicts, and the rest of the pipeline is untouched.

### Data at scale: GeoJSON → tiled source

At 185 points a static GeoJSON file is the right answer and clustering is the right answer
for stacked pins. That holds into the tens of thousands of points. Past that, the file
itself becomes the problem and the data has to be tiled (PMTiles, or PostGIS→MVT for live
data) so the browser fetches only the current viewport.

**Be honest about what that costs in product terms:** with a tiled source the browser no
longer holds the whole dataset, so "75 organizations · 185 sites" becomes "75 organizations
in this view," and the list can only list what is on screen. That is a real change to what
the page can promise a resident, and it is a product decision rather than a performance
default. Make it deliberately, when the data forces it.

---

## Using map-core in a finder

`map-core.js` is the reusable half: MapLibre setup, clustering, selection, highlight, the
coincident-address chooser, the live region, the map-side analytics. It knows nothing about
organizations, cards, lists, or URL parameters.

A finder — search box, filters, results list whose state is coupled to the map — should
**not** embed this app in an iframe. A finder's list and its map share too much state to
live on opposite sides of a `postMessage` boundary. It should import the core and wrap its
own UI around it:

```js
import { createMap } from "./map-core.js";
import { loadBasemapStyle, resolveLang } from "./basemap-style.js";

const lang  = resolveLang(new URLSearchParams(location.search).get("lang"));
const style = await loadBasemapStyle("https://tiles.openfreemap.org/styles/positron", lang);

const map = createMap(document.getElementById("map"), {
  style,
  data,                                     // GeoJSON FeatureCollection of Points
  onSelect(feature, { via, coincident }) {  // via: "map" | "api"
    renderYourCard(feature);
    if (coincident) renderYourChooser(coincident);   // >1 site at the clicked coordinate
  },
  onClusterExpand(count) { /* … */ },
});

map.setData(filteredGeojson);   // after a search or a filter change
map.select(siteId);             // or null to clear; fires onSelect with via:"api"
map.highlight(ids);             // emphasize a subset, mute the rest; [] clears
map.fitTo(ids);                 // fit the viewport to a subset
map.destroy();
```

`id` throughout is the `id` **property** of a feature — a stable string from the data
pipeline — not MapLibre's internal numeric feature id.

`embed.js` is the worked example, and it is deliberately a thin client: the list panel
drives the map only through `select` / `highlight` / `fitTo`, which is what demonstrates
that this API is enough for a second consumer to be written against.

Two implementation notes you would otherwise have to rediscover:

- **Three sources, not one.** Clustering is what makes 185 points readable and it is also
  what makes a highlight invisible — an organization's 60 sites are swallowed by the same
  count bubbles as everyone else's, at exactly the zoom where "this org is everywhere" is
  the thing you want to see. So the highlighted subset is drawn a second time from its own
  unclustered source on top, while the clustered base dims underneath. The selected site
  gets the same treatment, so a selection made from the list is visible even when its point
  would otherwise be inside a cluster.
- **Expressions, not feature-state.** Feature-state is the usual way to do
  selected/highlighted styling, but it is a poor fit over a clustered GeoJSON source: the
  ids it keys on change as clusters re-form, so state set at one zoom is lost at the next.
  At this scale an expression over a literal id list costs nothing and always holds.

Extract this into a versioned package when there is a second consumer, not before.

---

## Accessibility notes

Target is WCAG 2.2 AA. The federal ADA Title II deadline for public entities of this size
is 2027-04-26.

**The list is the map's text alternative.** A canvas cannot be read, and a screen-reader
user should not be told to "explore the map." Everything the map draws is reachable from
the list: 75 organizations as buttons, each multi-site organization expanding to its sites.
It is deliberately *not* a finder — no search, no filter, no sort — because a text
alternative's job is completeness, not discovery.

**Focus order** is title → skip link → list → map controls → card. The card is last in the
DOM and positioned over the map by CSS, which is why that order comes out right without any
`tabindex` above 0.

**There is a skip link**, invisible until it takes focus, because 75 organizations is 72 tab
stops between the top of the page and the map's own controls. It is the first focusable
thing in the block and it lands on the map container.

**Selection moves focus.** Choosing a site focuses the card's `<h2>` (`tabindex="-1"`), so
a keyboard user lands on what they asked for. Closing the card — button or `Escape` —
returns focus to the list row that opened it.

**One live region**, `aria-live="polite"`, owned by `map-core.js` and written by
`embed.js`. It announces `Selected: <organization>, <address>` and
`Showing <n> sites for <organization>`.

**Zoom controls** are MapLibre's own `NavigationControl` — real `<button>`s, focusable,
operable with Enter or Space. The canvas itself is one tab stop that pans with the arrow
keys.

**Touch targets**: every standalone control is at least 44 px on touch, including
MapLibre's zoom buttons, which default to 29 px and are resized here. The only smaller
targets are text links sitting inside a block of text — the phone number and website in the
card, and the basemap attribution — which SC 2.5.8 exempts as inline targets. Focus rings
are visible everywhere, including over the map.

**What `list=off` assumes.** It assumes the host page already carries the same information
in text — a single "visit our office" pin on a contact page, or a page that lists the
locations itself. `list=off` on a page that does not is a map with no text alternative, and
is not an accessible page. If you are reaching for `list=off` to save vertical space,
that's the wrong reason.

**Not yet done:** a VoiceOver / NVDA pass with a real screen-reader user, and sign-off from
the Mayor's Office for People with Disabilities on the list-as-text-alternative pattern.
That pattern is cheap to change now and expensive after a second map copies it.

---

## Language notes

nyc.gov is translated by a **proxy** — TransPerfect OneLink today, Smartling GDN later —
which fetches the page and rewrites its **DOM text nodes**. That single fact determines
every language decision in this block.

**There are no string files and no i18n library.** All copy is English in the markup, and
the proxy does the rest. What the block owes the proxy:

1. **Every visible string is a text node inside its own element.** A label is never glued
   to a value to make one string. `el("span", "Phone")` next to `el("span", number)`, never
   `"Phone: " + number` — a concatenated string is one text node the translator has to
   handle as a unit, and the value ends up inside the translatable segment.
2. **No visible text in attributes.** Screen-reader-only copy is a visually-hidden
   `<span>`, not an `aria-label`, because the proxy cannot see attribute values. The
   `.visually-hidden` class in `style.css` is there for exactly this.
3. **No canvas text.** Which leaves one exception, below.
4. **Pluralization is avoided rather than solved.** A multi-site organization shows
   `<n>` and `sites` as two separate nodes; a single-site organization shows no count at
   all. Nothing in the code builds `"1 site"` vs `"2 sites"`.

**The basemap is the exception**, and it is the only language logic in the block. Basemap
labels are drawn by the GPU onto a canvas, so the proxy cannot see them and the app has to
switch them itself. `basemap-style.js` fetches the style JSON and rewrites every
name-bearing `text-field` expression to:

```js
["coalesce", ["get", "name:es"], ["get", "name:latin"], ["get", "name"]]
```

The language comes from `?lang=`, else `<html lang>` (which is what the proxy sets on a
translated page, so the basemap follows the page without being told), else `en`. Highway
shield layers read `ref` and are left alone. OpenMapTiles carries `name:es`, `name:zh`,
`name:ru` and the other major languages; coverage is good for countries, cities, boroughs
and large features and thinner for individual streets, which is why the fallback chain ends
at the local name rather than at blank.

**The hosting requirement.** None of this works unless the block is served from a hostname
the translation proxy covers. An iframe from an uncovered hostname is an untranslated hole
in a translated page. This is the one real constraint the block puts on where it is
deployed — settle it before the embed ships, not after.

---

## Scorecard

Measured on this build, 2026-09-14. Where a comparison is quoted, it is the Google My Map
this replaces, benchmarked on the same instrument in the same session.

| Need | Result | Evidence |
|---|---|---|
| **basemap** | ✅ | No API key, no account, no billing relationship anywhere in the stack. Lighthouse network trace: **4 origins** (the app's own, `cdn.jsdelivr.net` for MapLibre, `tiles.openfreemap.org` for the basemap, plus data URIs) and **0 requests to a metered vendor**. The My Map makes 30 metered requests across 12 origins on every load. |
| **language** | ✅ | Every visible string is a text node in its own element — no concatenated label+value, no `aria-label` carrying visible copy, no canvas text except the cluster counts (numerals). `?lang=es` renders "Ciudad de Jersey", "estrecho de Long Island", "Isla Staten", "Bahía de Nueva York Baja"; `?lang=zh` renders the full CJK label set. Verified by rendering `embed.html` at `en`, `es` and `zh`. |
| **accessibility (keyboard)** | ✅ keyboard · 🟡 screen reader | Keyboard-only walk with no mouse: Tab 1 is the skip link → Enter lands on the map → Tab reaches the canvas, Zoom in, Zoom out, and Enter zooms. In the list, Enter on an organization opens the card with focus on its `<h2>`; Tab walks phone → website → Directions → Close; Enter on Close, or Escape, closes the card and returns focus to the exact row that opened it. Every one of the 185 sites is reachable this way. **Not yet done:** a VoiceOver/NVDA pass and MOPD sign-off on the pattern. |
| **mobile-friendly** | ✅ | Rendered at 360 × 740 and at desktop width. No horizontal overflow at 360 px (`scrollWidth` = viewport width). The bottom sheet cycles 48 px → 45 dvh → 85 dvh by tap or drag, and collapses on its own when a card opens so the two never fight for the screen. Every standalone control is ≥ 44 px on touch; the only smaller targets are text links inside a block of text, which SC 2.5.8 exempts. |
| **analytics** | ✅ events · 🟡 transport | `map_load`, `map_pin_open` (`via: map` / `list` / `chooser`), `map_list_expand`, `map_cluster_expand` and `map_directions_click` all observed on `window.dataLayer` and in the console during the interaction tests. The tag itself is not wired — see §Events. |
| **data integration** | ✅ | `python3 build/build.py` rebuilds from the KML or the CSV, resolves **185 / 185** addresses, and stamps `"generated"` with the build date, which the card footer renders. Gate tested by forcing a failure: with `MIN_RESOLVED` at 99.9% and one address broken, the build printed the unresolved list, exited 1, and left `app/sites.geojson` byte-identical. |
| **manual data edits** | ✅ | Hand-placed one address in `data/overrides.json` and rebuilt: the pin moved from `[-73.89262, 40.82877]` to the override's coordinate, proving overrides beat both the cache and the geocoder. Removing the entry and rebuilding restored it. |
| **stacked pins** | ✅ | Clusters expand on click via `getClusterExpansionZoom`. Selecting Acacia Housing and Preservation lights all **60** of its sites at once, unclustered and on top, while the rest of the city dims. At 1 State Street — where two different organizations share a coordinate — the card opens with a "2 sites at this address" chooser and picking the other one re-selects through the map. |
| **performance** | 🟡 | Lighthouse mobile profile (slow-4G, throttled Moto-G), **median of 5 round-robin runs**, served over gzip. Block: **Speed Index 2.4 s · LCP 5.0 s · TBT 325 ms · CLS 0.003 · 1,541 KB · 31 requests · 0 metered**. My Map: **Speed Index 6.7 s · LCP 10.7 s · TBT 433 ms · CLS 0.646 · 1,673 KB · 90 requests · 30 metered**. Faster on every metric, a third of the requests, a fifth of the layout shift, and nothing metered — but 1,541 KB is over the 0.5 MB target. See below. |

### On that 🟡 — where the 1,541 KB goes

| | |
|---|---|
| Basemap (tiles, sprite, glyphs) | **1,159 KB** |
| MapLibre GL JS | 298 KB |
| **Everything in this repository** | **83 KB** (app code 20 · `sites.geojson` 15 · `orgs.json` 46) |

The block's own payload is not the problem and could not realistically be much smaller.
The basemap is 75% of the page, and 900 KB of that is **six zoom-9 vector tiles**. Probing
`tiles.openfreemap.org` by hand at z9, z10 and z11 over New York, every tile came back
between 110 KB and 355 KB — because it is a full **planet** build, carrying detail for the
whole world at every level. There is no starting zoom that gets the city under 500 KB of
tiles on this basemap.

Two things follow, and they are the useful part of this row:

1. **This is the argument for self-hosting.** A Protomaps extract clipped to the NYC
   bounding box carries only what this map draws. The swap is already scoped in §Swapping
   a layer, and it is the single change that moves this row to ✅.
2. **Don't quote "total page weight" as the win.** The honest sentence is: *the application
   is 83 KB; the rest is the basemap, and the basemap is the layer we are bringing
   in-house.* For calibration, the existing Medicaid demo — same hosted basemap, same
   engine — measures 1,725 KB with an LCP of 8.7–9.5 s on this instrument, so the basemap
   cost is not something this block introduced.

Raw runs are in `~/projects/medicaid-map/bench/results/baseline.csv` under the names
`abawd` and `mymap`, one Lighthouse trace per run.

---

## Known gaps / production notes

Honest list of what a production build still needs.

1. **Self-host the sprites and glyphs.** The style pulls its icon sprite and its font
   glyph ranges from `tiles.openfreemap.org`. They move with the basemap when the PMTiles
   swap happens, and they are static files like everything else.
2. **Self-host MapLibre.** One file, and it removes the CDN from the runtime dependency
   list.
3. **Wire the analytics transport.** See §Events — the pushes exist, the tag does not.
4. **The proxied hostname.** See §Language notes. This is the one hosting constraint.
5. **A named data owner at HRA** for the SEVSP list, and a scheduled export to replace the
   hand-exported KML. The pipeline is ready for it; the ownership is not settled.
6. **A screen-reader pass and MOPD sign-off** on the list-as-text-alternative pattern.
7. **`window.nycMapKit`** is exposed on purpose as a console handle for this prototype
   (`nycMapKit.select(id)`, `.highlight([...])`, `.raw` for the MapLibre instance). Decide
   deliberately whether to keep it in production; it is read-only in practice but it is a
   global.
8. **The design system.** Colours are declared once as custom properties at the top of
   `style.css` (and the pin colours, which MapLibre paints on canvas and cannot read from
   CSS, once at the top of `map-core.js`). Replacing them with NYCDS tokens is a contained
   change, and the token names should be agreed before a second map copies these.
