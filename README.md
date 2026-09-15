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
| <http://localhost:8000/demo.html> | the demo page — the block embedded twice, at two sizes |
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
  a cache wipe. Three forms, and one entry may combine them:
  ```json
  { "<raw address>": { "query": "different text to ask GeoSearch" } }
  { "<raw address>": { "lon": -73.91513, "lat": 40.81403, "note": "why" } }
  { "<raw address>": { "maps_query": "text for the Open in Google Maps link" } }
  ```
  The first two move the pin on our map; the third moves only where Google lands when the
  resident taps through, and is carried onto that one feature as a `maps_query` property.
  They are separate because the two geocoders fail on different strings: GeoSearch is
  NYC-only and resolves no intersections, while Google is global and will read a
  cross-street description as an address somewhere else entirely.

**The 95% gate.** If fewer than 95% of addresses resolve, the build prints the unresolved
list and exits 1 without writing anything. A bad input file should stop the pipeline, not
quietly ship a half-empty map. Change `MIN_RESOLVED` in `build/build.py` to move the bar.

**The two addresses GeoSearch cannot place** (both in `data/overrides.json` with their
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

**Three more addresses carry a `maps_query`** — the pin is fine, only the Google link needed
help. They are the strings a global geocoder reads differently from an NYC-only one: a
hyphenated house-number *range* Google reads the Queens way (`190-192 Brown Place`), a
programme name and a colon typed into the address field (`Next PAGE: 801 Amsterdam Ave.`),
and a park with no house number at all, which is the one query in the set that is a place
name rather than an address — there is exactly one Chelsea Park in Manhattan, so it carries
none of the branch ambiguity an organization's name would. The two pin overrides above also
carry one, to strip the cross-street half of the string that Google would read as more
address.

**GeoSearch's silent fallbacks.** `build.py` takes `features[0]` without checking Pelias's
`match_type`, and Pelias answers a house number it does not have by returning a *different*
building on the same street, at confidence 0.8. Cross-checking all 185 addresses against the
[US Census geocoder](https://geocoding.geo.census.gov/) — an independent engine, run as a
one-off — found four pins that disagree by more than 300 m, and in each the address string is
right and our pin is wrong:

| address | our pin resolved to | apart |
|---|---|---|
| `115 Liberty Street, Bath New York 14810` | `115 Liberty Street`, **Manhattan** | 329 km |
| `832 3rd Avenue, Suite 10-10NE, Brooklyn` | `639 3 Avenue, Brooklyn` | 941 m |
| `25 Thorton Street, Brooklyn` (typo for *Thornton*) | `25 Lorimer Street, Brooklyn` | 779 m |
| `250 E 117st, New York` | `250 East 122 Street` | 398 m |

A fifth, `748 Beck Street, Bronx`, resolves to `810 Beck Street`. Because the link now carries
the address rather than the coordinate, these are the sites where the pin and the link will
point at different blocks — the link being the correct one. Gating on `match_type` and routing
fallbacks to `overrides.json` is the fix; it is not done.

The Bath one is not a geocoding bug at all. `Steuben County Community Mental Health Center`
(area code 607, `steubencountyny.gov`) is in Steuben County, 250 miles upstate, with `Borough:
Manhattan` typed into the source. GeoSearch, being NYC-only, had nowhere else to put it. The
row does not belong on a map of New York City and should be dropped at the source.

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
| `title` | string | `config.json`'s `title` | The block's `<h1>`. **Not drawn** — it is visually hidden, because the host page already has a heading naming the same thing. It still names the frame for a screen reader and still sets `document.title`. |

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
different dataset. The card has two parts, and the split is the point:

**`actions`** — the row of buttons directly under the address. The few things a resident is
most likely to have opened the card *for*, above anything describing the site. Each button
shows a verb and the information itself, so the number and the domain stay readable and
copyable on a desktop where `tel:` does nothing.

```json
"actions": [
  { "key": "phone",   "source": "site", "label": "Call",    "as": "tel" },
  { "key": "website", "source": "site", "label": "Website", "as": "url" }
]
```

**`card`** — the labelled detail below it, in the order given. Each entry names a field,
where to read it from (`site` = the GeoJSON feature's properties, `org` = the matching
record in `orgs.json`), its label, and optionally how to render it (`tel`, `url`).

```json
{ "key": "hours", "source": "org", "label": "Hours" }
```

**Open in Google Maps** is appended to the action row automatically, and
`"openInMaps": false` removes it. It is Google's documented
[Search URL](https://developers.google.com/maps/documentation/urls/get-started),
`https://www.google.com/maps/search/?api=1&query=…`. It used to be the Directions URL,
which opens a routing form already asking where the resident is coming from — a question
they have not been asked and may not want to answer. Showing them the place is the smaller,
likelier request, and routing is one tap further on inside the app that is better at it. A
deep link either way: no SDK, no API key, no billing account, no third-party script.

**What goes in `query` is the choice that matters**, and there are three answers, not two:

| `query` carries | what the resident gets | risk of the wrong place |
|---|---|---|
| the coordinate | an unlabelled pin. Google's own docs: *"there is a pin in the map, but no additional place information is provided on the map or in the side panel."* No title, no hours, no Street View. | none |
| **the address** ← what this does | Google's card for that address: the pin, Street View, a Directions button, and the businesses Google knows are there. | ~none |
| the name + the address | the organization's own Google profile — hours, photos, reviews — *when the name matches something Google has at that address*. | real |

The first row is why this is not the coordinate: an unlabelled dot is something the map the
resident is already looking at does better, so sending them to Google for one buys nothing.
The jump from nothing to a real panel is the address.

The third row was built and then removed. The name in this data is typed into a spreadsheet
by 75 different organizations and is never checked against Google's index, so prepending it
does not *look up* a place — it biases a text search. A miss is usually harmless, because
Google falls back to the address and you land on row two anyway. But a miss that matches a
**different branch of the same organization** sends the resident to the wrong building with
nothing on screen to say so. That is not hypothetical here: 20 addresses carry no ZIP, every
one of them belongs to a multi-site organization, and 13 of those are Henry Street Settlement
— 14 sites sharing one strong Google listing. Hours and photos are not worth a silent wrong
address.

```json
"openInMaps": {
  "query": [
    { "key": "address", "source": "site" }
  ]
}
```

Each entry is a field reference like the ones in `actions` and `card`, and non-empty values
are joined with commas — a dataset keeping street, city and state in separate columns lists
all three. `"openInMaps": true` keeps the coordinate instead, which is the right setting for
a dataset whose addresses are too rough to hand to a global geocoder.

**If you want the business profile guaranteed rather than guessed**, the mechanism is
`query_place_id`, not a better-composed string: one Places API Text Search per site at build
time, store the returned place ID (Google's terms allow caching place IDs indefinitely,
unlike the rest of the Places response), and emit `&query=<address>&query_place_id=<id>` so
the address is still the fallback. That needs an API key and a billing account — the first
metered dependency in this block — and it would also produce a useful QA list of which of the
75 organizations Google actually has a listing for. Not done.

**The remaining cost is that Google re-geocodes the address with its own engine**, so its pin
can land somewhere ours did not. Ours came from NYC GeoSearch, which sits on the city's own
address database and is the more authoritative of the two for a NYC house number — but only
for strings that are actually NYC addresses. Where Google reads one differently, the fix is a
`maps_query` in `data/overrides.json`, which moves only the link and leaves the pin alone; see
§Geocoding. It is written onto just those features, so the other 180 sites pay nothing for it.

A phone number written for a human keeps its extension: `"(212)766-9200 x2224"` becomes
`tel:2127669200;ext=2224`, the RFC 3966 form. 21 of the 185 sites carry one, and stripping
every non-digit would hand the phone `21276692002224` to dial.

---

## Overlapping pins

185 pins do not fit on a city-zoom screen, and no amount of styling changes that. At z10 a
pixel is about 116 m and a pin head is about 16 px, so:

| zoom | pins overlapping ≥1 other | deepest pile |
|---|---|---|
| 10 (city) | 166 / 185 (90%) | 49 |
| 12 | 122 / 185 (66%) | 18 |
| 14 | 68 / 185 (37%) | 7 |
| 16 | 27 / 185 (15%) | 3 |
| 17 | 12 / 185 (6%) | 2 |

**A click takes the topmost pin, at every zoom.** The user pointed at one mark and gets one
card. Zooming separates a pile, and the list carries every site at any zoom, so nothing is
unreachable — it is reachable by reading rather than by aiming.

Be honest about the cost: a pin underneath another gives no sign that it is there. Esri's
community forums carry the same complaint about their paginated popup. It is the price of
not aggregating, and the list is what pays it.

**Clustering is the alternative and it is off** (`createMap(el, { cluster: true })`). It
aggregates marks, never cards — a bubble reading "37" is true where 37 overlapping
teardrops claiming to be 37 clickable places are not — but it trades the sight of where
every site is for a count, and it puts a numeral on the canvas where the translation proxy
and a screen reader cannot reach it. Turn it on at the scale where the shape itself stops
reading; this dataset is not there.

### What was removed, and why it matters for the next dataset

An earlier version answered a click by querying a ±6 px box and listing everything in it
inside the card, headed "N sites at this address". At z10 that box is **1.4 km wide**. One
site's card listed 37 others, six of them belonging to different organizations, under a
heading naming one organization. Pixel proximity is not co-location, and a card that says
otherwise is wrong rather than merely crowded.

The rule the block keeps instead: **a card is one record, everywhere** — from a pin, from
the list, always. Anything that helps you get to a different record is chrome around the
card, never content inside it — in the DOM as well as on screen: the stepper is a sibling
of the `<article>`, not a child.

### True co-location: the stepper

Records within **25 m** of each other are one location. The number is not in the data —
the pair distances in this file run continuously from 0 to 160 m with no gap anywhere, the
largest jump between consecutive pairs being 8 m — so it comes from what the label
promises. 25 m is the widest radius where "at this location" is still true: the same
building or the one next door. At 50 m it starts joining addresses on different streets.

Note this is *not* "what the user cannot separate by zooming", which would be 0 m — at z18
even a 15 m gap is about 35 px. It is a claim about the places, not the pixels, which is
why it is a fixed ground distance rather than a function of zoom. A record joins a group
only if it is within 25 m of every member, not just the nearest, so groups cannot chain.

Five groups in the ABAWD data, covering ten sites, none deeper than two. The card carries
the only way to reach the second record in one:

```
┌──────────────────────────────────────┐
│  ‹     1 of 2 at this location    ›  │   ← chrome: its own element, fixed height
└──────────────────────────────────────┘
┌──────────────────────────────────────┐
│  Metropolitan New York Coordinating  │   ← the card: exactly one record
│  Council on Jewish Poverty           │
│  1 State St 24th Floor…              │
```

This is Felt's pattern (arrows to step between overlapping features) with ArcGIS's count
added, which is the part that matters: without it there is no way to know a second record
is there at all. It wraps rather than disabling at the ends — with a stack of two,
disabling would leave one arrow permanently dead, and the count already says where you
are. Focus stays on the arrow you pressed, so a second press steps again.

Co-location is a fact about the **data**, not about the render, so `embed.js` computes it
from the feature collection (`indexByCoordinate`) and `map-core.js` says nothing about it.
A finder written against the core does the same with its own UI.

The five, and they differ in kind:

| Sites | Apart | What it is |
|---|---|---|
| 1 State St 24th Fl / 1 State Street | 0 m | Met Council and Women In Need genuinely share the building |
| 399 E Mosholu Pkwy N / 3031 Webster Ave | 0 m | one organization on a corner lot, two real addresses, one geocode |
| 415 / 417 E 151st Street | 7.9 m | Acacia, two adjacent buildings |
| 265 / 269 Henry Street | 15.6 m | Henry Street Settlement, two doors of one campus |
| 701 / 705 Crotona Park North | 17.2 m | Acacia, two adjacent buildings |

All five are "at this location"; only two are "at this address". The copy says location.

---

## Events

The block pushes to `window.dataLayer` inside the iframe and logs every push to the console.

| Event | Payload | When |
|---|---|---|
| `map_load` | `{sites, orgs, lang}` | Map style and layers are up. |
| `map_pin_open` | `{org_id, site_id, via}` | A site is selected. `via` is `map`, `list`, or `stepper`. |
| `map_cluster_expand` | `{count}` | A cluster bubble is clicked. Only fires with `cluster: true`, which is off by default. |
| `map_action_click` | `{org_id, site_id, action}` | A configured action button is used; `action` is its config key (`phone`, `website`). |
| `map_open_in_maps_click` | `{org_id, site_id}` | The Open in Google Maps button is used. |

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
demo has run on since 2026-09-10 — with a warm tint applied at load time by
`warmTint()` in `app/basemap-style.js`.

**Why tint rather than pick a warmer style.** OpenFreeMap also serves `bright` and
`liberty`, both of which are warmer out of the box. Both are also more opinionated: green
parks, blue water, coloured road classes, and in liberty's case 3D building extrusions at
high zoom. This block is a base for maps whose data nobody has chosen yet, so the basemap
has to stay neutral enough to sit under any of them — a basemap that is already using
green and blue for its own purposes takes those colours away from the data. Positron is
the quiet, flat one; the tint gives it a paper tone without giving it opinions.

The tint holds *chroma* constant rather than saturation, so the same amount of warmth
lands on the near-white background and on the mid-grey boundary lines — a fixed saturation
would be invisible on the former and heavy on the latter. Labels are untouched, since
their colours are a contrast decision. Water and parks are the one exception to
neutrality: `embed.js` passes them a soft blue and a soft green (`BASEMAP_PALETTE`), enough
for the rivers and the big parks to work as landmarks and still well under the pins. Note
that positron does not draw city parks at all — in OpenMapTiles data Central Park is
`landcover` class `grass`, not a `park` feature, and positron paints `landcover` only for
wood and ice — so `addLandcoverParks()` inserts a fill layer for grass landcover first.
Tuning is two constants (`WARM_HUE`, `WARM_CHROMA`) plus that palette; passing the style
through unchanged turns it off.

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
it came from, and both the label-language rewrite in `setStyleLanguage()` and the tint in
`warmTint()` work on any style object, self-hosted or not — neither reads the URL, and the
tint keys off colour lightness rather than a list of layer ids, so an upstream restyle does
not silently undo it.

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

At 185 points a static GeoJSON file is the right answer, and it holds into the tens of
thousands. Past that the file itself becomes the problem and the data has to be tiled
(PMTiles, or PostGIS→MVT for live data) so the browser fetches only the current viewport.

Note that clustering (`createMap(el, { cluster: true })`, off by default) is a
*readability* threshold rather than a data-size one, and the two are far apart: see
§Overlapping pins.

**Be honest about what that costs in product terms:** with a tiled source the browser no
longer holds the whole dataset, so "75 organizations · 185 sites" becomes "75 organizations
in this view," and the list can only list what is on screen. That is a real change to what
the page can promise a resident, and it is a product decision rather than a performance
default. Make it deliberately, when the data forces it.

---

## Using map-core in a finder

`map-core.js` is the reusable half: MapLibre setup, clustering, selection, highlight, the
live region, the map-side analytics. It knows nothing about organizations, cards, lists,
URL parameters — or co-location, which is a fact about the data and therefore the client's
to compute. See §Overlapping pins.

A finder — search box, filters, results list whose state is coupled to the map — should
**not** embed this app in an iframe. A finder's list and its map share too much state to
live on opposite sides of a `postMessage` boundary. It should import the core and wrap its
own UI around it:

```js
import { createMap } from "./map-core.js";
import { addLandcoverParks, loadBasemapStyle, resolveLang, warmTint } from "./basemap-style.js";

const lang  = resolveLang(new URLSearchParams(location.search).get("lang"));
const style = warmTint(                                  // drop warmTint() for stock positron
  addLandcoverParks(                                     // city parks; positron omits them
    await loadBasemapStyle("https://tiles.openfreemap.org/styles/positron", lang)),
  { water: "hsl(202, 42%, 80%)", park: "hsl(96, 30%, 84%)" });   // both optional

const map = createMap(document.getElementById("map"), {
  style,
  data,                                     // GeoJSON FeatureCollection of Points
  onSelect(feature, { via }) {               // via: "map" | "api"
    renderYourCard(feature);                 // always exactly one feature
  },
  onClusterExpand(count) { /* … */ },
  focusPoint: () => [x, y],                  // optional: where a selected pin lands, in
                                             // container px; default is the map's centre
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

- **Three sources, not one.** The highlighted subset is drawn a second time from its own
  source on top, at full size, while the base dims and shrinks underneath — so "this org
  is everywhere" reads at city zoom, where the base pins are small and dense. The selected
  site gets the same treatment, so a selection made from the list is always the mark on
  top. With `cluster: true` this matters more, not less: an organization's 60 sites would
  otherwise be swallowed by the same count bubbles as everyone else's.
- **Pins are generated, not fetched.** The teardrop is drawn to a canvas at load and
  registered with `map.addImage()`, one image per state, because an icon's colour is baked
  into its image. Three states, three images, and the layer expression picks between them.
  No asset to host, and no licence taken on the icon set the city's finders drew theirs
  from.
- **Size interpolates over zoom.** ~0.55× at city zoom to ~1.15× at street zoom, the same
  technique the child care finder uses, flattened at the low end so the smallest pin is
  still a touch target. It reduces the pile-up at z10; it does not remove it — see
  §Overlapping pins.
- **Expressions, not feature-state.** Feature-state is the usual way to do
  selected/highlighted styling, but it is a poor fit over a clustered GeoJSON source: the
  ids it keys on change as clusters re-form, so state set at one zoom is lost at the next.
  Since clustering is an option this block can turn on, the styling stays on expressions,
  which cost nothing at this scale and always hold.

Extract this into a versioned package when there is a second consumer, not before.

---

## Accessibility notes

Target is WCAG 2.2 AA. The federal ADA Title II deadline for public entities of this size
is 2027-04-26.

**The list is the map's text alternative.** A canvas cannot be read, and a screen-reader
user should not be told to "explore the map." Everything the map draws is reachable from
the list: **185 rows, one per site**, each showing the organization and then the address,
each opening the same card its pin opens, **ordered north to south** so the list runs down
the city the way the map does. It is deliberately *not* a finder — no search, no filter, no
sort controls — because a text alternative's job is completeness, not discovery.

It is flat on purpose. The list used to be 75 organizations, the multi-site ones expanding
to reveal their sites, which made a row mean two different things depending on which
organization it named — some opened a card, some opened a sublist, and the only tells were
a blank chevron and a missing count. A card is one record from every direction, so a row
is too. The cost is 60 consecutive rows reading "Acacia Housing and Preservation", which is
what the address line is for.

**Focus order** is skip link → list → map controls → card. The card is last in the DOM and
positioned over the map by CSS, which is why that order comes out right without any
`tabindex` above 0. The block's `<h1>` comes before all of it in *reading* order but is not
focusable and is not drawn — see below.

**The heading is in the DOM but not on the screen.** The block is an iframe inside a
nyc.gov page that already carries an `<h1>` naming what the page is about, so drawing the
name a second time at the top of the map spent a line of vertical space repeating something
the resident had just read. It stays in the markup, visually hidden, doing three jobs that
have nothing to do with being seen: it is the block's only `<h1>`, so deleting it would
leave a frame whose document has no heading outline; it is what a screen reader announces
on entering the frame, which is the only way a non-sighted user learns what the frame
contains; and it is the landmark the list and map sit under. `.block-header` is zeroed out
in `style.css` so the empty element does not still paint its old padding and rule.

**There is a skip link**, invisible until it takes focus, because 185 sites is 185 tab
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
| **language** | ✅ | Every visible string is a text node in its own element — no concatenated label+value, no `aria-label` carrying visible copy, no canvas text at all now that the cluster counts are off by default. `?lang=es` renders "Ciudad de Jersey", "estrecho de Long Island", "Isla Staten", "Bahía de Nueva York Baja"; `?lang=zh` renders the full CJK label set. Verified by rendering `embed.html` at `en`, `es` and `zh`. |
| **accessibility (keyboard)** | ✅ keyboard · 🟡 screen reader | Keyboard-only walk with no mouse: Tab 1 is the skip link → Enter lands on the map → Tab reaches the canvas, Zoom in, Zoom out, and Enter zooms. In the list, Enter on a row opens that site's card with focus on its `<h2>`; Tab walks Call → Website → Open in Google Maps → Close; Enter on Close, or Escape, closes the card and returns focus to the exact row that opened it. Every one of the 185 sites is reachable this way. **Not yet done:** a VoiceOver/NVDA pass and MOPD sign-off on the pattern. |
| **mobile-friendly** | ✅ | Rendered at 360 × 740 and at desktop width. No horizontal overflow at 360 px (`scrollWidth` = viewport width). The bottom sheet cycles 48 px → 45 dvh → 85 dvh by tap or drag, and collapses on its own when a card opens so the two never fight for the screen. Every standalone control is ≥ 44 px on touch; the only smaller targets are text links inside a block of text, which SC 2.5.8 exempts. |
| **analytics** | ✅ events · 🟡 transport | `map_load`, `map_pin_open` (`via: map` / `list` / `stepper`), `map_action_click` and `map_open_in_maps_click` all observed (`map_cluster_expand` fires only with `cluster: true`) on `window.dataLayer` and in the console during the interaction tests. `via: stepper` re-verified 9/15 by CDP. The tag itself is not wired — see §Events. |
| **data integration** | ✅ | `python3 build/build.py` rebuilds from the KML or the CSV, resolves **185 / 185** addresses, and stamps `"generated"` with the build date, which the card footer renders. Gate tested by forcing a failure: with `MIN_RESOLVED` at 99.9% and one address broken, the build printed the unresolved list, exited 1, and left `app/sites.geojson` byte-identical. |
| **manual data edits** | ✅ | Hand-placed one address in `data/overrides.json` and rebuilt: the pin moved from `[-73.89262, 40.82877]` to the override's coordinate, proving overrides beat both the cache and the geocoder. Removing the entry and rebuilding restored it. |
| **stacked pins** | ✅ | Re-verified 9/15 in headless Chrome over CDP, after the ±6 px box query was removed (see §Overlapping pins). A click at z10 on the densest block of the South Bronx opens **one** card — one `<h2>`, one button, 494 characters — where the same click previously produced a 37-entry list naming six other organizations. All **five** co-located groups step correctly: 1 of 2 → 2 of 2 → back, the card body swapping to the other record each time, focus following the arrow pressed, and no stepper on any of the other 175 sites. The list is 185 rows with 185 distinct site ids and no other buttons in it, so every row is one card. No console errors. |
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
