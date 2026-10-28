/**
 * map-core.ts — the reusable map.
 *
 * This is the half of the block that has no opinions about the dataset. It knows about
 * points, clusters, selection, and highlight. It does NOT know what an organization is,
 * what a card looks like, what a list is, or that URL parameters exist — all of that is
 * the client's job. The React UI in src/ui/ is the first client and the worked example.
 *
 * WHY THE SPLIT. The next thing built on this block is a finder: search box, filters, a
 * results list whose hover state drives the map. A finder's list and map share too much
 * state to sit on opposite sides of an iframe `postMessage` boundary, so the finder will
 * NOT embed this app — it will `import { createMap }` and wrap its own UI around it.
 * That is only possible if the map never reaches outside its own container, which is the
 * rule this file keeps.
 *
 *   import { createMap } from "./map-core.ts";
 *
 *   const map = createMap(document.getElementById("map"), {
 *     style,                         // style URL or style object (see basemap-style.ts)
 *     data,                          // GeoJSON FeatureCollection of Points
 *     onSelect(feature, info),       // info = {via}
 *     onClusterExpand(count),
 *     focusPoint,                    // optional () => [x, y]: where a selected pin lands,
 *                                    // in container pixels. Default: the container's centre.
 *     pin,                           // optional: the default pin's colour and glyph (PinStyle)
 *     categories,                    // optional: pins coloured by one property (PinCategories)
 *     counts,                        // optional: true puts on each pin how many sites are
 *                                    // drawn on its exact coordinates, where above 1
 *     zoomButtons,                   // optional: false leaves out the + and − buttons
 *   });
 *
 *   map.setData(geojson);            // replace the data
 *   map.select(id | null);           // select + fly to; fires onSelect with via:"api"
 *   map.highlight(ids);              // e.g. every site of one org; [] clears
 *   map.fitTo(ids);                  // fit the viewport to a subset
 *   map.showPlace(place, ids);       // mark a searched-for place and frame it with `ids`
 *   map.destroy();
 *
 * MapCoreOptions and MapCore, below, are the exact contract.
 *
 * `id` throughout is the `id` PROPERTY of a feature (a stable string from the data
 * pipeline), not MapLibre's internal numeric feature id.
 *
 * OVERLAPPING PINS. 185 pins do not fit on a city-zoom screen. At z10 a pin head is
 * ~16 px across and a pixel is ~116 m, so 90% of them touch another one and the worst
 * pile is 49 deep. Two things absorb that, and neither aggregates a card:
 *
 * The click always takes the TOPMOST pin, at every zoom. That is the honest answer to a
 * pile: the user pointed at one mark and gets the card for one mark. Zooming separates the
 * pile (~7 deep at z14, ~3 at z16, ~2 at z17), and the client's list carries every site
 * regardless of zoom, so nothing is unreachable — it is reachable by reading rather than
 * by aiming. The cost, and it is a real one, is that a pin sitting underneath another
 * gives the user no sign it is there. Esri's own forums report the same complaint about
 * their paginated popup; it is the price of not aggregating.
 *
 * What this core does NOT do is guess which pin a click "meant". An earlier version
 * queried a +/-6 px box and handed the client every feature in it; at z10 that box is
 * 1.4 km wide, so one site's card listed 37 others, six of them from different
 * organizations, under the heading "sites at this address". Pixel proximity is not
 * co-location, and a card that says otherwise is wrong rather than merely crowded.
 *
 * Clustering (`cluster: true`) is the other way to absorb a pile and it stays available,
 * off by default. It aggregates marks, never cards — a bubble reading "37" is true where
 * 37 overlapping teardrops claiming to be 37 clickable places are not — but it trades the
 * sight of where every site is for a count, and it puts a number on the canvas where the
 * translation proxy and a screen reader cannot reach it.
 *
 * TRUE co-location — two records on one coordinate, which no zoom will ever separate —
 * is a property of the DATA, not of the render. So this core says nothing about it and
 * the client computes it from the feature collection it already has. The UI does,
 * and offers a counted stepper. There are two such pairs in the ABAWD data.
 *
 * MapLibre comes from npm, pinned in package.json, and is bundled with the app, so the
 * block serves its own copy instead of depending on a CDN at runtime. Under a bundler,
 * MapLibre v6 cannot find its web worker on its own, so the worker is imported through
 * Vite's `?worker&url` and handed over with `setWorkerUrl` once, before any map exists.
 * (Plain `?url` emits the worker without the shared chunk it imports, and vector tiles
 * then silently fail to load.) Its stylesheet is imported here too, so any page that
 * imports this file gets working zoom buttons and attribution without a separate link.
 *
 * A `pmtiles://` source reads its tiles out of one PMTiles file by HTTP range request, with
 * no tile server; the Protomaps basemap (basemaps/protomaps.ts) is one. The protocol is
 * registered here once, like the worker, so any map the core creates can draw one. Each
 * file is read through a RereadingSource, below.
 */

import type { Feature, FeatureCollection, Point } from "geojson";
import * as maplibregl from "maplibre-gl";
import type { ExpressionSpecification, GeoJSONSource, StyleSpecification } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import { FetchSource, PMTiles, Protocol } from "pmtiles";
import { STATION_ICON, STATION_ICON_DPR, stationIcon } from "./station-icon.ts";

/**
 * A FetchSource that reads once more, past the browser's cache, when a read fails.
 *
 * A browser that kept part of the file asks for a range with If-Range. Every deploy
 * restamps the file's Last-Modified and ETag, so after one the server answers with the
 * whole file instead of the range (RFC 9110 §13.1.5), and FetchSource rejects that. The
 * Protocol keeps a failed header read, so without a second read no tile would load until
 * the page did. The second read, and every read after it, uses cache "reload", which
 * sends no If-Range.
 */
class RereadingSource extends FetchSource {
  override async getBytes(offset: number, length: number, signal?: AbortSignal, etag?: string) {
    try {
      return await super.getBytes(offset, length, signal, etag);
    } catch (err) {
      // An aborted read was cancelled on purpose. A source already reloading has failed
      // past the cache, or has FetchSource's own ETag retry under way.
      if (signal?.aborted || this.mustReload) throw err;
      this.mustReload = true;
      return super.getBytes(offset, length, signal, etag);
    }
  }
}

maplibregl.setWorkerUrl(workerUrl);
const pmtiles = new Protocol();
maplibregl.addProtocol("pmtiles", (params, abort) => {
  // The Protocol makes a plain FetchSource for a file it has not been given, so it is
  // given each one first. The URL is pmtiles://<file>, or pmtiles://<file>/z/x/y.
  const file = params.url.slice("pmtiles://".length).replace(/\/\d+\/\d+\/\d+$/, "");
  if (!pmtiles.get(file)) pmtiles.add(new PMTiles(new RereadingSource(file)));
  return pmtiles.tilev4(params, abort);
});

// -------------------------------------------------------------------------------- types

/** What the core needs on a feature: an `id` property. The rest belongs to the client. */
export interface PointProperties {
  id: string;
}

/** How a selection was made: a click on a pin, or a call to `select()`. */
export interface SelectInfo {
  via: "map" | "api";
}

/** A pin's colour, and its glyph as SVG path data on a 24-unit square (see pinImage). A
 *  glyph is stroked, like an icon, unless `fill` makes it a solid mark (see pins.ts).
 *  Without a glyph the pin has the default's hole. */
export interface PinStyle {
  color: string;
  glyph?: string;
  fill?: boolean;
}

/**
 * Pins in a colour of their own, with a glyph in the head, by the value of one property.
 * The core knows nothing of what the values mean: the client names the property and gives
 * each value its colour and glyph. A value not listed, or a site without the property,
 * draws the default pin.
 */
export interface PinCategories {
  /** The property that holds the category, such as "type". */
  field: string;
  /** Each value's pin. */
  values: Record<string, PinStyle>;
}

/** createMap's options. `P` is the client's feature properties. */
export interface MapCoreOptions<P extends PointProperties> {
  style?: StyleSpecification | string;
  data?: FeatureCollection<Point, P>;
  cluster?: boolean;
  /** Every pin's colour and glyph, but for those `categories` gives their own. The orange
   *  pin with a hole (PIN.base) unless given. */
  pin?: PinStyle | null;
  categories?: PinCategories | null;
  /** Each pin carries, at the top right of its head, how many sites the data puts on its
   *  exact coordinates, where that is more than one. Sites merely close by are not
   *  counted: their pins come apart as the reader zooms in (see OVERLAPPING PINS above),
   *  and a number on one of two would mislead. */
  counts?: boolean;
  onSelect?: (feature: Feature<Point, P> | null, info: SelectInfo) => void;
  onClusterExpand?: (count: number) => void;
  focusPoint?: (() => [number, number] | null) | null;
  /** The + and − buttons in the top-right corner. On unless set to false. */
  zoomButtons?: boolean;
  /** The id of an element in the client's markup that tells a keyboard user how to move
   *  the map. The canvas names it in aria-describedby, so a screen reader reads it when
   *  the map takes focus. The words are the client's, for the same reason as the live
   *  region's. */
  describedBy?: string | null;
}

/** A place the client searched for: a point, and for an area the box to frame. */
export interface PlaceMark {
  center: [number, number];
  /** West, south, east, north. */
  bbox?: [number, number, number, number] | null;
  /** Draw a dot at `center`. On unless set to false. */
  mark?: boolean;
}

/** The map createMap returns. Each method is described where it is written, in `api`. */
export interface MapCore<P extends PointProperties> {
  readonly raw: maplibregl.Map;
  setData(geojson: FeatureCollection<Point, P> | null): MapCore<P>;
  select(id: string | null): MapCore<P>;
  highlight(ids: string[]): MapCore<P>;
  fitTo(ids: string[]): MapCore<P>;
  showPlace(place: PlaceMark | null, ids?: string[]): MapCore<P>;
  readonly selectedId: string | null;
  announce(content: string | Node | null): void;
  ready(fn: () => void): MapCore<P>;
  destroy(): void;
}

/** A coordinate as MapLibre takes it. GeoJSON types the same pair as number[]. */
type LngLat = [number, number];

// --------------------------------------------------------------------------- appearance
// Marks, not text, so the bar is WCAG 2.2 SC 1.4.11 non-text contrast (3:1) against the
// warm-tinted positron basemap and against each other — not the 4.5:1 text ratio.
const PIN = {
  // The orange the city's child care finder draws its centre-based sites in — the
  // uniqueValue renderer on its PROD_childcarenyc layer.
  base: "#f38600",
  cluster: "#f38600",
  stroke: "#ffffff",
};

// The teardrop itself. Drawn rather than fetched: it is a circle, two tangent lines and a
// hole, so generating it costs less than an asset to host and avoids taking a licence on
// the icon set the finders drew theirs from. Sized in CSS pixels; rendered at PIN_DPR and
// handed to MapLibre with a matching pixelRatio, so it stays crisp on retina.
const PIN_SHAPE = { width: 26, height: 34, stroke: 1.5, hole: 0.34, halo: 2.5 };
const PIN_DPR = 2;

/** A glyph's stroke, in its own 24-unit square, and how much of the head's radius the
 *  square spans. */
const GLYPH = { stroke: 2.5, span: 1.2 };

/** The count on a pin that shares its spot: a black circle ringed in white, centred on
 *  the head's top-right edge, with the number in white. `pad` is the room it takes beyond
 *  the pin on the left, right and top; the left keeps the tip centred under the anchor. */
const BADGE = { radius: 7, stroke: 1.5, font: "700 10px 'Noto Sans', sans-serif", pad: 6 };
/** The property the core adds to a drawn pin that shares its spot: how many do. */
const HERE = "_here";

/** One pin as ImageData, in `fill`, optionally ringed in `halo`, with `glyph` (SVG path
 *  data on a 24-unit square) in white in its head — stroked, or filled when `solid` — or
 *  else the hole, and `count` in a badge when it is above 1. The ring is drawn inside the
 *  same canvas — the pin shrinks to make room — so every state shares one geometry and the
 *  tip still lands on the coordinate. */
function pinImage(
  fill: string, halo: string | null, glyph?: string, count = 1, solid = false,
): ImageData {
  const { width: w, height: h, stroke, hole, halo: haloWidth } = PIN_SHAPE;
  const pad = count > 1 ? BADGE.pad : 0;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil((w + 2 * pad) * PIN_DPR);
  canvas.height = Math.ceil((h + pad) * PIN_DPR);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(PIN_DPR, PIN_DPR);
  ctx.translate(pad, pad);

  const inset = halo ? haloWidth : 0;
  const r = (w - stroke) / 2 - inset;
  const cx = w / 2;
  const cy = r + stroke / 2 + inset;
  const tip = h - stroke / 2 - inset;
  // Where the tangent lines from the tip meet the head, so the tail joins it smoothly
  // instead of cutting a notch into it.
  const phi = Math.acos(Math.min(1, r / (tip - cy)));

  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI / 2 + phi, Math.PI / 2 - phi);   // over the top of the head
  ctx.lineTo(cx, tip);
  ctx.closePath();
  if (halo) {
    ctx.lineWidth = stroke + haloWidth * 2;
    ctx.strokeStyle = halo;
    ctx.stroke();
  }
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = stroke;
  ctx.strokeStyle = PIN.stroke;
  ctx.stroke();

  if (glyph) {
    const size = r * GLYPH.span;
    ctx.save();
    ctx.translate(cx - size / 2, cy - size / 2);
    ctx.scale(size / 24, size / 24);
    if (solid) {
      ctx.fillStyle = PIN.stroke;
      ctx.fill(new Path2D(glyph), "evenodd");
    } else {
      ctx.lineWidth = GLYPH.stroke;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke(new Path2D(glyph));
    }
    ctx.restore();
  } else {
    ctx.beginPath();
    ctx.arc(cx, cy, r * hole, 0, Math.PI * 2);
    ctx.fillStyle = PIN.stroke;
    ctx.fill();
  }

  if (count > 1) {
    const bx = cx + r * Math.SQRT1_2;
    const by = cy - r * Math.SQRT1_2;
    ctx.beginPath();
    ctx.arc(bx, by, BADGE.radius, 0, Math.PI * 2);
    ctx.fillStyle = "#000000";
    ctx.fill();
    ctx.lineWidth = BADGE.stroke;
    ctx.strokeStyle = PIN.stroke;
    ctx.stroke();
    ctx.fillStyle = PIN.stroke;
    ctx.font = BADGE.font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(count), bx, by + 0.5);
  }

  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** The pin an image id draws, and in which state, with how many sites it counts: its
 *  category's pin where it names one listed, or else `pin`. Null for an id that is not a
 *  pin's. */
export function pinFor(
  id: string, categories: PinCategories | null, pin: PinStyle,
): { style: PinStyle; state: keyof typeof PIN_IMAGE; count: number } | null {
  const match = /^pin-(base|dimmed|selected)(?::(.+?))?(?:\+(\d+))?$/.exec(id);
  if (!match) return null;
  const category = match[2] && categories ? categories.values[match[2]] : null;
  return {
    style: category ?? pin,
    state: match[1] as keyof typeof PIN_IMAGE,
    count: match[3] ? Number(match[3]) : 1,
  };
}

/** `color` mixed with `toward` (0–255 per channel), keeping `keep` of it. */
function mix(color: string, toward: number, keep: number): string {
  return "#" + [1, 3, 5]
    .map((i) => Math.round(parseInt(color.slice(i, i + 2), 16) * keep + toward * (1 - keep)))
    .map((v) => v.toString(16).padStart(2, "0")).join("");
}

/** A pin's three states from its one colour, the default orange's and every category's
 *  alike: lightened when dimmed ("still here, not what you asked about"), darkened when
 *  selected (the one you are looking at), and the selected pin ringed in the lightened
 *  colour. The darker fill and the larger size are what say "selected"; the ring sets it
 *  off from the pins around it, in its own colour, so its kind still reads. */
function shades(color: string): Record<keyof typeof PIN_IMAGE | "halo", string> {
  const dimmed = mix(color, 255, 0.45);
  return { base: color, dimmed, selected: mix(color, 0, 0.55), halo: dimmed };
}

/** Image ids registered on the map, one per state. */
const PIN_IMAGE = { base: "pin-base", dimmed: "pin-dimmed", selected: "pin-selected" };
// Clustering is off: every site draws as its own pin at every zoom, and a click takes the
// topmost. Be clear-eyed about what that costs — at z10 a pin head is ~16 px and a pixel
// is ~116 m, so 90% of this dataset's pins touch another one and the worst pile is 49
// deep. What the map shows there is a shape, not a countable set; the list is what makes
// the set countable. The option stays for the scale where even the shape stops reading.
const CLUSTER_MAX_ZOOM = 14;   // with cluster:true, above this points draw individually
const CLUSTER_RADIUS = 40;
const NYC_BOUNDS: [LngLat, LngLat] = [[-74.30, 40.47], [-73.65, 40.95]];
// The zoom a selection made off the map — from the list, or through the API — eases in
// to, if the map is further out. z15 is where individual blocks read: ~4.7 m per pixel at
// NYC's latitude, so a Manhattan block is ~17 × 57 px. A map already closer than this is
// left at its zoom, and so is a pin the reader clicked on the map (see applySelection).
const STREET_ZOOM = 15;
// The area the map opens within: NYC_BOUNDS plus roughly 10 km on each side, so Jersey
// City, Yonkers and the Nassau line are in frame as context. The opening view shows no
// more than this, centred within it as far as it can be, until the reader moves the map.
const OPENING_BOUNDS: [LngLat, LngLat] = [[-74.42, 40.39], [-73.53, 41.03]];
// How far the camera may leave the city: OPENING_BOUNDS and 0.1° of longitude more on
// each side, about 150 px at a laptop's opening zoom, so the opening view can pan east
// and west too. MapLibre's maxBounds does two things at once: it stops the pan at the
// edge, and it stops zooming out at the point where the bounds fill the container. The
// basemap file covers the same area (BBOX in build/protomaps.sh).
const MAX_BOUNDS: [LngLat, LngLat] = [[-74.52, 40.39], [-73.43, 41.03]];

// A value no real site id can equal, so "nothing is selected" is expressible inside a
// MapLibre expression (which has no notion of null).
const NO_SELECTION = "∅";

const EMPTY: FeatureCollection<Point, never> = { type: "FeatureCollection", features: [] };

// The four layers that draw individual sites (as opposed to cluster bubbles). A click
// anywhere in this set is a click on a site; MapLibre hands back the topmost one, which
// is the one the user actually pointed at.
const POINT_LAYERS = ["focus-site", "overlay-sites", "sites", "site-dots"];

/** A site where pins do not fit: a dot in the pin's colour, 7 px across, ringed in white. */
const DOT = { radius: 3.5, stroke: 1 };
/** How many sites pins carry at `zoom`: twice as many at each zoom level in. */
const PINS_FIT = { sites: 1000, zoom: 10 };

/**
 * The zoom from which `count` sites draw as pins; below it they draw as dots.
 *
 * Past a certain density a pile of pins stops reading as pins: each covers all of the
 * one behind it but a sliver of its white outline, and the pile turns white. Pins carry
 * about PINS_FIT.sites sites at PINS_FIT.zoom, and twice as many at each zoom level in.
 * Zooming in one level spreads the sites over four times the screen, but the pins grow
 * as the map zooms (see sitesSize), and set by eye on 547 to 12,053 sites over Midtown
 * Manhattan the factor is closer to two. The count is the sites shown, so a filter that
 * leaves fewer brings the pins back sooner.
 *
 * A whole zoom level, rounded up, because MapLibre builds a layer for each whole-zoom
 * tile it shows at any part of: at a fractional switch both layers would be built for the
 * tile in between, and a click could land on a site drawn only in the hidden one.
 */
export function pinZoom(count: number): number {
  return Math.max(0, Math.ceil(PINS_FIT.zoom + Math.log2(count / PINS_FIT.sites)));
}

/** Push a map-side analytics event. The host page's tag reads window.dataLayer. */
function track(event: string, payload: Record<string, unknown>): void {
  window.dataLayer = window.dataLayer || [];
  const row = Object.assign({ event }, payload);
  window.dataLayer.push(row);
  // The prototype has no tag wired up, so the console is the observable surface.
  console.log("[dataLayer]", row);
}

/** The smallest box centred on `center` that holds every one of `points`: each point is
 *  taken with its mirror image across the centre. Mirrored in degrees rather than on
 *  screen, which differ by metres across a borough. */
export function centredOn(center: LngLat, points: LngLat[]): [LngLat, LngLat] {
  const dx = Math.max(...points.map(([x]) => Math.abs(x - center[0])));
  const dy = Math.max(...points.map(([, y]) => Math.abs(y - center[1])));
  return [[center[0] - dx, center[1] - dy], [center[0] + dx, center[1] + dy]];
}

export function createMap<P extends PointProperties>(
  container: HTMLElement, options: MapCoreOptions<P> = {},
): MapCore<P> {
  const {
    style,
    data = EMPTY,
    cluster = false,
    pin = null,
    categories = null,
    counts = false,
    onSelect = () => {},
    onClusterExpand = () => {},
    focusPoint = null,
    zoomButtons = true,
    describedBy = null,
  } = options;

  // ------------------------------------------------------------------ live region
  // Map interaction is pointer-driven and visual; a screen reader gets nothing from a
  // canvas repaint. The core owns the one live region — it lives inside the container,
  // which keeps the "no DOM outside the container" rule intact — but it does not write
  // English into it. The core has no copy of its own; the client announces through
  // `map.announce()` so every announced string stays in the client's markup where the
  // translation proxy can reach it.
  const liveRegion = document.createElement("div");
  liveRegion.className = "mapcore-live";
  liveRegion.setAttribute("aria-live", "polite");
  liveRegion.setAttribute("role", "status");
  container.appendChild(liveRegion);

  const map = new maplibregl.Map({
    container,
    style,
    bounds: NYC_BOUNDS,
    fitBoundsOptions: { padding: 24 },
    maxBounds: MAX_BOUNDS,
    minZoom: 9,
    maxZoom: 18,
    attributionControl: { compact: true },
    // North stays up and the map stays flat. By default MapLibre turns and tilts it on a
    // right-drag or Ctrl-drag (on a trackpad, a two-finger click that moves), a two-finger
    // twist or drag on a touchscreen, and Shift with an arrow key; with no compass, nothing
    // on the map turns it back.
    dragRotate: false,
    touchPitch: false,
  });
  map.touchZoomRotate.disableRotation();   // a pinch still zooms
  map.keyboard.disableRotation();          // the arrow keys still pan, + and − still zoom
  // The canvas is a single tab stop that pans with the arrow keys. Everything a keyboard
  // user actually needs — every site — is reachable from the client's list; the zoom
  // buttons, unless the client leaves them out, are real <button>s and take focus in order.
  if (describedBy) map.getCanvas().setAttribute("aria-describedby", describedBy);
  if (zoomButtons) {
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  }

  let currentData = data;
  let selectedId: string | null = null;
  let highlighted: string[] = [];
  let ready = false;
  let destroyed = false;
  const pending: (() => void)[] = [];   // work queued before the style finishes loading

  const byId = new Map<string, Feature<Point, P>>();
  // With `counts`, how many sites share each shared spot, by id. Every site at a spot
  // carries the count: they stack exactly at every zoom, and MapLibre does not promise
  // which of them it draws on top.
  const hereById = new Map<string, number>();
  function indexData(fc: FeatureCollection<Point, P>): void {
    byId.clear();
    hereById.clear();
    const features = (fc && fc.features) || [];
    for (const f of features) byId.set(f.properties.id, f);
    if (!counts) return;
    const atSpot = new Map<string, string[]>();
    for (const f of features) {
      const spot = f.geometry.coordinates.join();
      atSpot.set(spot, [...(atSpot.get(spot) ?? []), f.properties.id]);
    }
    for (const ids of atSpot.values()) {
      if (ids.length > 1) for (const id of ids) hereById.set(id, ids.length);
    }
  }
  indexData(currentData);

  /** `features` as the map draws them: each with its count, where it has one, under a
   *  property of the core's own, so the client's features are never changed. */
  function drawn(features: Feature<Point, P>[]): FeatureCollection<Point, P> {
    return {
      type: "FeatureCollection",
      features: hereById.size ? features.map((f) => {
        const here = hereById.get(f.properties.id);
        return here ? { ...f, properties: { ...f.properties, [HERE]: here } } : f;
      }) : features,
    };
  }

  function whenReady(fn: () => void): void {
    if (ready) fn();
    else pending.push(fn);
  }

  /** Announce through the map's live region. Accepts a string or a DOM node — a node,
   *  so the client can keep each visible string in its own element (see the language
   *  rule in the README). Re-setting identical content does not re-announce in some
   *  screen readers, so the region is cleared first. */
  function announce(content: string | Node | null): void {
    liveRegion.replaceChildren();
    window.setTimeout(() => {
      if (destroyed) return;
      if (content instanceof Node) liveRegion.replaceChildren(content);
      else liveRegion.textContent = content == null ? "" : String(content);
    }, 40);
  }

  // ------------------------------------------------------------------ paint expressions
  // Selection and highlight are data-driven: the paint properties read the current
  // selected id and highlight set out of the expression, so a state change is a handful
  // of setPaintProperty calls and no re-parse of the source data.
  //
  // (MapLibre feature-state would be the other way to do this. It is a poor fit here:
  // the source is clustered, and feature-state on a clustered GeoJSON source is keyed to
  // ids that change as clusters re-form, so state set at one zoom is lost at the next.
  // At 185 points an expression over a literal id list costs nothing and always holds.)
  const isSelected = (): ExpressionSpecification =>
    ["==", ["get", "id"], selectedId ?? NO_SELECTION];

  /** The image for a pin in `state`: its category's, where it has one listed, and with
   *  its count, where it shares its spot. A counted image is drawn the first time the map
   *  asks for it (see styleimagemissing below), so only the counts in use are made. */
  const categoryValues = categories ? Object.keys(categories.values) : [];
  function pinIcon(state: keyof typeof PIN_IMAGE): ExpressionSpecification | string {
    let id: ExpressionSpecification | string = PIN_IMAGE[state];
    if (categories && categoryValues.length) {
      const value: ExpressionSpecification = ["to-string", ["get", categories.field]];
      id = ["match", value, categoryValues, ["concat", PIN_IMAGE[state], ":", value],
        PIN_IMAGE[state]];
    }
    if (!counts) return id;
    const count: ExpressionSpecification = ["to-number", ["get", HERE], 1];
    return ["case", [">", count, 1], ["concat", id, "+", ["to-string", count]], id];
  }

  /** A pin image by its id: a state's, a category's, and either with a count. */
  const basePin: PinStyle = pin ?? { color: PIN.base };
  function imageFor(id: string): ImageData | null {
    const found = pinFor(id, categories, basePin);
    if (!found) return null;
    const { style: { color, glyph, fill }, state, count } = found;
    const shade = shades(color);
    return pinImage(shade[state], state === "selected" ? shade.halo : null, glyph, count, fill);
  }
  map.on("styleimagemissing", (e) => {
    const image = imageFor(e.id);
    if (image && !map.hasImage(e.id)) map.addImage(e.id, image, { pixelRatio: PIN_DPR });
  });
  // The basemaps' subway stations (basemap-style.ts): their icon, added with the style,
  // before any tile is laid out, so no station is drawn without it.
  map.on("style.load", () => {
    if (!map.hasImage(STATION_ICON)) {
      map.addImage(STATION_ICON, stationIcon(), { pixelRatio: STATION_ICON_DPR });
    }
  });

  // State is carried by which pin image is drawn and how big, rather than by a fill
  // colour: an icon's colour is baked into its image, so the three states are three
  // registered images and the expression picks between them.
  function sitesIcon(): ExpressionSpecification | string {
    if (!highlighted.length) {
      return ["case", isSelected(), pinIcon("selected"), pinIcon("base")];
    }
    return pinIcon("dimmed");     // the highlighted ones are drawn by the overlay instead
  }
  /**
   * Pin size, as a multiple of the drawn image, interpolated over zoom.
   *
   * Unclustered points need this. At city zoom 185 full-size pins are a single red mass;
   * at street zoom small ones are hard to hit. From z15 in, the pins are the size of the
   * city's child care finder's (about 35 px tall at z15). Below that they shrink less than
   * its do, because that map groups sites into counted circles at city zoom and this one
   * does not: at z10–11 a pin is still about 24 px tall, big enough to tap and for the
   * glyph in its head to read.
   *
   * The zoom interpolation has to be the OUTER expression: MapLibre only accepts `zoom`
   * at the top level of a layout property, so the per-state multiplier goes inside each
   * stop rather than wrapping the whole thing.
   */
  const SIZE_STOPS: [zoom: number, size: number][] = [[9, 0.65], [12, 0.85], [15, 1.15], [18, 1.3]];
  function sizeCurve(at: (size: number) => number | ExpressionSpecification): ExpressionSpecification {
    return ["interpolate", ["linear"], ["zoom"], ...SIZE_STOPS.flatMap(([z, k]) => [z, at(k)])];
  }
  function sitesSize(): ExpressionSpecification {
    const state: number | ExpressionSpecification =
      highlighted.length ? 0.72 : ["case", isSelected(), 1.25, 1];
    return sizeCurve((k) => ["*", k, state]);
  }

  /** The same curve for the layers that are always drawn at one state. */
  function fixedSize(factor: number): ExpressionSpecification {
    return sizeCurve((k) => k * factor);
  }
  function sitesOpacity(): number {
    return highlighted.length ? 0.55 : 1;
  }
  /** A dot's colour: its category's, in the shade its pin takes, as pinIcon picks it. */
  function dotColor(): ExpressionSpecification | string {
    const state = highlighted.length ? "dimmed" : "base";
    const base = shades(basePin.color)[state];
    if (!categories || !categoryValues.length) return base;
    return ["match", ["to-string", ["get", categories.field]],
      ...categoryValues.flatMap((value) => [value, shades(categories.values[value].color)[state]]),
      base] as ExpressionSpecification;
  }
  /** Draw the shown sites as pins from the zoom they fit at, and as dots below it. */
  function fitPins(): void {
    const zoom = pinZoom(currentData.features.length);
    map.setLayerZoomRange("site-dots", 0, zoom);
    map.setLayerZoomRange("sites", zoom, 24);
  }

  /**
   * Why there are three sources rather than one.
   *
   * Clustering is what makes 185 points readable, but it is also what makes a highlight
   * invisible: an organization's 60 sites are swallowed by the same count bubbles as
   * everyone else's, so "highlight this org" changes nothing on screen at city zoom —
   * which is exactly the zoom at which you want to see that an organization is
   * everywhere. So the highlighted subset is drawn a second time from its own
   * UNCLUSTERED source, on top, while the clustered base dims underneath.
   *
   * The selected site gets the same treatment for the same reason: a selection made from
   * a list must be visible even if that point is inside a cluster.
   */
  function subset(ids: string[]): FeatureCollection<Point, P> {
    return drawn(ids.map((id) => byId.get(id)).filter(Boolean) as Feature<Point, P>[]);
  }

  function repaint() {
    if (!ready || destroyed) return;
    map.setLayoutProperty("sites", "icon-image", sitesIcon());
    map.setLayoutProperty("sites", "icon-size", sitesSize());
    map.setPaintProperty("sites", "icon-opacity", sitesOpacity());
    map.setPaintProperty("site-dots", "circle-color", dotColor());
    map.setPaintProperty("site-dots", "circle-opacity", sitesOpacity());
    map.setPaintProperty("site-dots", "circle-stroke-opacity", sitesOpacity());
    if (cluster) {
      map.setPaintProperty("clusters", "circle-opacity", highlighted.length ? 0.35 : 0.9);
      map.setPaintProperty("cluster-count", "text-opacity", highlighted.length ? 0.5 : 1);
    }
    map.getSource<GeoJSONSource>("overlay")!.setData(subset(highlighted));
    map.getSource<GeoJSONSource>("focus")!.setData(subset(selectedId ? [selectedId] : []));
  }

  // ------------------------------------------------------------------ layers
  map.on("load", () => {
    if (destroyed) return;
    for (const id of Object.values(PIN_IMAGE)) {
      for (const each of [id, ...categoryValues.map((value) => `${id}:${value}`)]) {
        if (!map.hasImage(each)) map.addImage(each, imageFor(each)!, { pixelRatio: PIN_DPR });
      }
    }

    // A searched-for place: a black dot ringed in white, under the pins so it never takes
    // a click meant for a site. Black, not a hue, because colour on this map means a site.
    map.addSource("place", { type: "geojson", data: EMPTY });
    map.addLayer({
      id: "place-halo",
      type: "circle",
      source: "place",
      paint: { "circle-radius": 16, "circle-color": "#000000", "circle-opacity": 0.15 },
    });
    map.addLayer({
      id: "place",
      type: "circle",
      source: "place",
      paint: {
        "circle-radius": 6,
        "circle-color": "#000000",
        "circle-stroke-width": 3,
        "circle-stroke-color": "#ffffff",
      },
    });

    map.addSource("sites", {
      type: "geojson",
      data: drawn(currentData.features),
      cluster,
      clusterRadius: CLUSTER_RADIUS,
      // Deliberately below maxZoom: past this zoom every point draws on its own and a
      // click takes the topmost. Only consulted when `cluster` is on.
      clusterMaxZoom: CLUSTER_MAX_ZOOM,
    });

    if (cluster) map.addLayer({
      id: "clusters",
      type: "circle",
      source: "sites",
      filter: ["has", "point_count"],
      paint: {
        "circle-color": PIN.cluster,
        "circle-opacity": 0.9,
        "circle-stroke-width": 2,
        "circle-stroke-color": PIN.stroke,
        "circle-radius": ["step", ["get", "point_count"], 15, 10, 20, 30, 26],
      },
    });
    if (cluster) map.addLayer({
      id: "cluster-count",
      type: "symbol",
      source: "sites",
      filter: ["has", "point_count"],
      layout: {
        // A numeral, so this canvas text needs no translation. Every other string in the
        // block is a DOM text node — see README §Language notes.
        "text-field": ["get", "point_count_abbreviated"],
        "text-font": ["Noto Sans Bold"],
        "text-size": 12,
      },
      paint: { "text-color": "#ffffff" },
    });
    // The sites as dots, below the zoom their pins fit at (see fitPins).
    map.addLayer({
      id: "site-dots",
      type: "circle",
      source: "sites",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-radius": DOT.radius,
        "circle-color": dotColor(),
        "circle-opacity": sitesOpacity(),
        "circle-stroke-width": DOT.stroke,
        "circle-stroke-color": PIN.stroke,
        "circle-stroke-opacity": sitesOpacity(),
      },
    });
    map.addLayer({
      id: "sites",
      type: "symbol",
      source: "sites",
      filter: ["!", ["has", "point_count"]],
      layout: {
        "icon-image": sitesIcon(),
        "icon-size": sitesSize(),
        // The point is the tip of the pin, not its middle.
        "icon-anchor": "bottom",
        // Symbol layers hide colliding icons by default. That is right for labels and
        // wrong for data: a pin that silently disappears at one zoom is a site the map
        // is lying about. Overlap is resolved by zooming, and by the client's list.
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
      paint: { "icon-opacity": sitesOpacity() },
    });

    // The highlighted organization's sites, drawn unclustered over the dimmed base.
    map.addSource("overlay", { type: "geojson", data: EMPTY });
    map.addLayer({
      id: "overlay-sites",
      type: "symbol",
      source: "overlay",
      layout: {
        "icon-image": pinIcon("base"),
        "icon-size": fixedSize(1),
        "icon-anchor": "bottom",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    });

    // The one selected site, always on top and always visible.
    map.addSource("focus", { type: "geojson", data: EMPTY });
    map.addLayer({
      id: "focus-site",
      type: "symbol",
      source: "focus",
      layout: {
        "icon-image": pinIcon("selected"),
        "icon-size": fixedSize(1.25),
        "icon-anchor": "bottom",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    });
    fitPins();

    for (const name of [...(cluster ? ["clusters"] : []), ...POINT_LAYERS]) {
      map.on("mouseenter", name, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", name, () => { map.getCanvas().style.cursor = ""; });
    }

    if (cluster) map.on("click", "clusters", (e) => {
      const feature = e.features && e.features[0];
      if (!feature) return;
      const count = feature.properties.point_count;
      const source = map.getSource<GeoJSONSource>("sites")!;
      Promise.resolve(source.getClusterExpansionZoom(feature.properties.cluster_id))
        .then((zoom) => map.easeTo({
          center: (feature.geometry as Point).coordinates as LngLat, zoom,
        }))
        .catch(() => {});
      track("map_cluster_expand", { count });
      onClusterExpand(count);
    });

    for (const layer of POINT_LAYERS) {
      map.on("click", layer, (e) => {
        const feature = e.features && e.features[0];
        const id = feature && feature.properties && feature.properties.id;
        if (!id) return;
        applySelection(id, "map");
      });
    }

    ready = true;
    // Frame the data rather than a hardcoded bounding box. For the full 185 sites this
    // lands on roughly the same view as NYC_BOUNDS; for a one-point map it is the
    // difference between a legible location and a speck in the middle of the region.
    // Instant, so there is no camera animation on first paint.
    fitToIds([], 0);
    keepWithinOpening();
    while (pending.length) pending.shift()!();
  });

  // Until the reader moves the map, the view keeps within OPENING_BOUNDS, also when its
  // frame changes size, as when a page's layout around it changes. A camera move already
  // under way, such as framing a search, is left to finish: jumpTo would stop it short.
  let readerMoved = false;
  map.on("movestart", (e) => { if (e.originalEvent) readerMoved = true; });
  map.on("resize", () => keepWithinOpening());
  function keepWithinOpening(): void {
    if (readerMoved || map.isMoving()) return;
    const { clientWidth: width, clientHeight: height } = map.getContainer();
    if (!width || !height) return;
    // Web Mercator x and y, in the units of a 512 px world at zoom 0.
    const x = (lng: number) => ((lng + 180) / 360) * 512;
    const y = (lat: number) =>
      (512 / (2 * Math.PI)) * (Math.PI - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)));
    const [[west, south], [east, north]] = OPENING_BOUNDS;
    const left = x(west), right = x(east), top = y(north), bottom = y(south);
    // Zoomed in until the bounds fill the frame both ways, as maxBounds would hold it.
    const fill = Math.max(Math.log2(width / (right - left)), Math.log2(height / (bottom - top)));
    const zoom = Math.max(map.getZoom(), fill);
    const scale = 2 ** zoom;
    const halfW = width / 2 / scale, halfH = height / 2 / scale;
    const c = map.getCenter();
    const cx = Math.min(Math.max(x(c.lng), left + halfW), right - halfW);
    const cy = Math.min(Math.max(y(c.lat), top + halfH), bottom - halfH);
    const lng = (cx / 512) * 360 - 180;
    const lat = (Math.atan(Math.sinh(Math.PI - (2 * Math.PI * cy) / 512)) * 180) / Math.PI;
    map.jumpTo({ zoom, center: [lng, lat] });
  }

  // MapLibre frames for the container size it last measured, and its ResizeObserver
  // measures a frame or more after a layout change. A client that changes the layout
  // around the map and frames a place in the same step would be framed for the old size,
  // so a frame measures the container first.
  function measure(): void {
    const box = map.getContainer(), canvas = map.getCanvas();
    if (box.clientWidth !== canvas.clientWidth || box.clientHeight !== canvas.clientHeight) {
      map.resize();
    }
  }

  function fitToIds(ids: string[], duration: number): void {
    const list = (ids && ids.length ? ids.map((i) => byId.get(i)) : [...byId.values()])
      .filter(Boolean) as Feature<Point, P>[];
    if (!list.length) return;
    measure();
    if (list.length === 1) {
      map.easeTo({
        center: list[0].geometry.coordinates as LngLat, zoom: STREET_ZOOM, duration,
      });
      return;
    }
    const b = new maplibregl.LngLatBounds();
    for (const f of list) b.extend(f.geometry.coordinates as LngLat);
    map.fitBounds(b, { padding: 60, maxZoom: STREET_ZOOM, duration });
  }

  // Where the camera puts a selected pin, as MapLibre's `offset` from the container's
  // centre. The core does not know what surrounds its container — a list beside it, a
  // card over it — so the client says where the pin should land and the core only does
  // the arithmetic. No `focusPoint` means the container's own centre.
  // MapLibre measures an easeTo's offset from the centre of the padded viewport (see
  // keepClearOfList in ui/layout.ts), so the offset is taken from there too.
  function focusOffset(): [number, number] {
    const point = focusPoint ? focusPoint() : null;
    if (!point) return [0, 0];
    const box = map.getContainer().getBoundingClientRect();
    const { left = 0, right = 0, top = 0, bottom = 0 } = map.getPadding();
    const cx = left + (box.width - left - right) / 2;
    const cy = top + (box.height - top - bottom) / 2;
    return [point[0] - cx, point[1] - cy];
  }

  function applySelection(id: string, via: SelectInfo["via"]): void {
    const previous = byId.get(selectedId as string) || null;
    selectedId = id;
    repaint();
    const feature = byId.get(id) || null;
    if (feature) {
      const [lon, lat] = feature.geometry.coordinates;
      // Every selection brings the pin to the focus point, so the card has somewhere to
      // open and the pin is not left under it.
      //
      // Only a selection made away from the map also eases in to street level: from the
      // list the pin may be off screen entirely, so the camera has to say where it went.
      // A pin click is different — the reader already found the pin at the scale they
      // chose, and zooming under their finger throws away the surroundings they were
      // using to read it. Centring is enough there.
      //
      // The one exception to moving at all is stepping between two records at one
      // location while they are drawn within a pin's reach of each other: the camera is
      // already there, and a lurch on every step would say the map had gone somewhere
      // when it had not. Measured in pixels rather than metres because it is a question
      // about what is on screen, which is the core's business; what counts as one
      // *place* is the client's, and it decides that in metres.
      const from = previous ? map.project(previous.geometry.coordinates as LngLat) : null;
      const to = map.project([lon, lat]);
      const stepping = via !== "map" && from && Math.hypot(to.x - from.x, to.y - from.y) < 60;
      if (!stepping) {
        map.easeTo({
          center: [lon, lat],
          zoom: via === "map" ? map.getZoom() : Math.max(map.getZoom(), STREET_ZOOM),
          duration: 700,
          offset: focusOffset(),
        });
      }
    }
    onSelect(feature, { via });
  }

  // ------------------------------------------------------------------ public API
  const api: MapCore<P> = {
    /** The underlying MapLibre instance. Escape hatch — prefer the methods below. */
    get raw() { return map; },

    setData(geojson) {
      currentData = geojson || EMPTY;
      indexData(currentData);
      whenReady(() => {
        map.getSource<GeoJSONSource>("sites")!.setData(drawn(currentData.features));
        fitPins();
        if (selectedId && !byId.has(selectedId)) selectedId = null;
        repaint();
      });
      return api;
    },

    /** Select a site by its `id` property, or clear with null. Fires onSelect. */
    select(id) {
      if (id == null) {
        selectedId = null;
        repaint();
        onSelect(null, { via: "api" });
        return api;
      }
      whenReady(() => applySelection(id, "api"));
      return api;
    },

    /** Emphasize a set of sites and mute the rest. Pass [] to clear. */
    highlight(ids) {
      highlighted = Array.isArray(ids) ? ids.slice() : [];
      repaint();
      return api;
    },

    /** Fit the viewport to a subset of sites (all of them if `ids` is empty). */
    fitTo(ids) {
      whenReady(() => fitToIds(ids, 600));
      return api;
    },

    /** Mark a place and frame it together with the sites in `ids` (the client picks
     *  which: the nearest few, say), with the place in the middle. Pass null to remove
     *  the mark; the camera stays. */
    showPlace(place, ids = []) {
      whenReady(() => {
        const marked = place && place.mark !== false;
        map.getSource<GeoJSONSource>("place")!.setData(marked ? {
          type: "Feature", properties: {}, geometry: { type: "Point", coordinates: place.center },
        } : EMPTY);
        if (!place) return;
        measure();
        const near = ids.map((id) => byId.get(id)).filter(Boolean) as Feature<Point, P>[];
        if (!place.bbox && !near.length) {
          map.easeTo({ center: place.center, zoom: STREET_ZOOM, duration: 700 });
          return;
        }
        // The place is the middle of the frame, which reaches out as far as the area, if
        // the place is one, and the sites, on whichever side of it they are.
        const reach = near.map((f) => f.geometry.coordinates as LngLat);
        if (place.bbox) reach.push([place.bbox[0], place.bbox[1]], [place.bbox[2], place.bbox[3]]);
        map.fitBounds(centredOn(place.center, reach),
          { padding: 60, maxZoom: STREET_ZOOM, duration: 700 });
      });
      return api;
    },

    /** Read-only view of what is selected. */
    get selectedId() { return selectedId; },

    /** Speak through the map's live region. Takes a string or a DOM node. */
    announce,

    /** Resolve once the style and layers are up — used for the map_load event. */
    ready(fn) { whenReady(fn); return api; },

    destroy() {
      destroyed = true;
      try { map.remove(); } catch { /* already gone */ }
      liveRegion.remove();
    },
  };

  return api;
}

export { PIN, CLUSTER_MAX_ZOOM, NYC_BOUNDS, track };
