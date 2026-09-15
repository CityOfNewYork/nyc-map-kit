/**
 * map-core.js — the reusable map.
 *
 * This is the half of the block that has no opinions about the dataset. It knows about
 * points, clusters, selection, and highlight. It does NOT know what an organization is,
 * what a card looks like, what a list is, or that URL parameters exist — all of that is
 * the client's job. `embed.js` is the first client and the worked example.
 *
 * WHY THE SPLIT. The next thing built on this block is a finder: search box, filters, a
 * results list whose hover state drives the map. A finder's list and map share too much
 * state to sit on opposite sides of an iframe `postMessage` boundary, so the finder will
 * NOT embed this app — it will `import { createMap }` and wrap its own UI around it.
 * That is only possible if the map never reaches outside its own container, which is the
 * rule this file keeps.
 *
 *   import { createMap } from "./map-core.js";
 *
 *   const map = createMap(document.getElementById("map"), {
 *     style,                         // style URL or style object (see basemap-style.js)
 *     data,                          // GeoJSON FeatureCollection of Points
 *     onSelect(feature, info),       // info = {via}
 *     onClusterExpand(count),
 *     focusPoint,                    // optional () => [x, y]: where a selected pin lands,
 *                                    // in container pixels. Default: the container's centre.
 *   });
 *
 *   map.setData(geojson);            // replace the data
 *   map.select(id | null);           // select + fly to; fires onSelect with via:"api"
 *   map.highlight(ids);              // e.g. every site of one org; [] clears
 *   map.fitTo(ids);                  // fit the viewport to a subset
 *   map.destroy();
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
 * the client computes it from the feature collection it already has. `embed.js` does,
 * and offers a counted stepper. There are two such pairs in the ABAWD data.
 *
 * MapLibre is loaded as an ES module from a CDN. v6 ships no UMD build, so there is no
 * `<script src>`+global form of this any more; native `import` is the no-build path.
 * See README §Swapping a layer for self-hosting it.
 */

import * as maplibregl from "https://cdn.jsdelivr.net/npm/maplibre-gl@6.8.0/dist/maplibre-gl.mjs";

// --------------------------------------------------------------------------- appearance
// Marks, not text, so the bar is WCAG 2.2 SC 1.4.11 non-text contrast (3:1) against the
// warm-tinted positron basemap and against each other — not the 4.5:1 text ratio.
const PIN = {
  // The orange the city's child care finder draws its centre-based sites in — the
  // uniqueValue renderer on its PROD_childcarenyc layer.
  base: "#f38600",
  dimmed: "#f7cc97",      // the same orange, lightened — "still here, not what you asked about"
  selected: "#854900",    // the same orange, darkened — the one you are looking at
  cluster: "#f38600",
  stroke: "#ffffff",
  // Amber ring on the selected pin, and now close enough in hue to the base that it is
  // purely decorative: the darker fill and the larger size are what say "selected".
  halo: "#ffab00",
};

// The teardrop itself. Drawn rather than fetched: it is a circle, two tangent lines and a
// hole, so generating it costs less than an asset to host and avoids taking a licence on
// the icon set the finders drew theirs from. Sized in CSS pixels; rendered at PIN_DPR and
// handed to MapLibre with a matching pixelRatio, so it stays crisp on retina.
const PIN_SHAPE = { width: 26, height: 34, stroke: 1.5, hole: 0.34, halo: 2.5 };
const PIN_DPR = 2;

/** One pin as ImageData, in `fill`, optionally ringed in `halo`. The ring is drawn inside
 *  the same canvas — the pin shrinks to make room — so every state shares one geometry and
 *  the tip still lands on the coordinate. */
function pinImage(fill, halo) {
  const { width: w, height: h, stroke, hole, halo: haloWidth } = PIN_SHAPE;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(w * PIN_DPR);
  canvas.height = Math.ceil(h * PIN_DPR);
  const ctx = canvas.getContext("2d");
  ctx.scale(PIN_DPR, PIN_DPR);

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

  ctx.beginPath();
  ctx.arc(cx, cy, r * hole, 0, Math.PI * 2);
  ctx.fillStyle = PIN.stroke;
  ctx.fill();

  return ctx.getImageData(0, 0, canvas.width, canvas.height);
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
const NYC_BOUNDS = [[-74.30, 40.47], [-73.65, 40.95]];

// A value no real site id can equal, so "nothing is selected" is expressible inside a
// MapLibre expression (which has no notion of null).
const NO_SELECTION = "∅";

const EMPTY = { type: "FeatureCollection", features: [] };

// The three layers that draw individual sites (as opposed to cluster bubbles). A click
// anywhere in this set is a click on a site; MapLibre hands back the topmost one, which
// is the one the user actually pointed at.
const POINT_LAYERS = ["focus-site", "overlay-sites", "sites"];

/** Push a map-side analytics event. The host page's tag reads window.dataLayer. */
function track(event, payload) {
  window.dataLayer = window.dataLayer || [];
  const row = Object.assign({ event }, payload);
  window.dataLayer.push(row);
  // The prototype has no tag wired up, so the console is the observable surface.
  console.log("[dataLayer]", row);
}

export function createMap(container, options = {}) {
  const {
    style,
    data = EMPTY,
    cluster = false,
    onSelect = () => {},
    onClusterExpand = () => {},
    focusPoint = null,
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
    minZoom: 9,
    maxZoom: 18,
    attributionControl: { compact: true },
  });
  // The canvas is a single tab stop that pans with the arrow keys. Everything a keyboard
  // user actually needs — every site — is reachable from the client's list; these zoom
  // buttons are real <button>s and take focus in order.
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

  let currentData = data;
  let selectedId = null;
  let highlighted = [];
  let ready = false;
  let destroyed = false;
  const pending = [];        // work queued before the style finishes loading

  const byId = new Map();
  function indexData(fc) {
    byId.clear();
    for (const f of (fc && fc.features) || []) byId.set(f.properties.id, f);
  }
  indexData(currentData);

  function whenReady(fn) {
    if (ready) fn();
    else pending.push(fn);
  }

  /** Announce through the map's live region. Accepts a string or a DOM node — a node,
   *  so the client can keep each visible string in its own element (see the language
   *  rule in the README). Re-setting identical content does not re-announce in some
   *  screen readers, so the region is cleared first. */
  function announce(content) {
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
  const isSelected = () => ["==", ["get", "id"], selectedId ?? NO_SELECTION];

  // State is carried by which pin image is drawn and how big, rather than by a fill
  // colour: an icon's colour is baked into its image, so the three states are three
  // registered images and the expression picks between them.
  function sitesIcon() {
    if (!highlighted.length) {
      return ["case", isSelected(), PIN_IMAGE.selected, PIN_IMAGE.base];
    }
    return PIN_IMAGE.dimmed;      // the highlighted ones are drawn by the overlay instead
  }
  /**
   * Pin size, as a multiple of the drawn image, interpolated over zoom.
   *
   * Unclustered points need this. At city zoom 185 full-size pins are a single red mass;
   * at street zoom small ones are hard to hit. The city's child care finder solves it the
   * same way — a size visual variable running ~6px at city scale to ~29px at street
   * scale — so the curve here is theirs, flattened at the low end: their smallest pin is
   * decorative, ours has to stay clickable, and a 44px touch target is the floor that
   * sets.
   *
   * The zoom interpolation has to be the OUTER expression: MapLibre only accepts `zoom`
   * at the top level of a layout property, so the per-state multiplier goes inside each
   * stop rather than wrapping the whole thing.
   */
  function sitesSize() {
    const state = highlighted.length ? 0.72 : ["case", isSelected(), 1.25, 1];
    const at = (k) => ["*", k, state];
    return ["interpolate", ["linear"], ["zoom"],
      9, at(0.55), 12, at(0.75), 15, at(1), 18, at(1.15)];
  }

  /** The same curve for the layers that are always drawn at one state. */
  function fixedSize(factor) {
    return ["interpolate", ["linear"], ["zoom"],
      9, 0.55 * factor, 12, 0.75 * factor, 15, 1 * factor, 18, 1.15 * factor];
  }
  function sitesOpacity() {
    return highlighted.length ? 0.55 : 1;
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
  function subset(ids) {
    const features = ids.map((id) => byId.get(id)).filter(Boolean);
    return { type: "FeatureCollection", features };
  }

  function repaint() {
    if (!ready || destroyed) return;
    map.setLayoutProperty("sites", "icon-image", sitesIcon());
    map.setLayoutProperty("sites", "icon-size", sitesSize());
    map.setPaintProperty("sites", "icon-opacity", sitesOpacity());
    if (cluster) {
      map.setPaintProperty("clusters", "circle-opacity", highlighted.length ? 0.35 : 0.9);
      map.setPaintProperty("cluster-count", "text-opacity", highlighted.length ? 0.5 : 1);
    }
    map.getSource("overlay").setData(subset(highlighted));
    map.getSource("focus").setData(subset(selectedId ? [selectedId] : []));
  }

  // ------------------------------------------------------------------ layers
  map.on("load", () => {
    if (destroyed) return;
    for (const [state, id] of Object.entries(PIN_IMAGE)) {
      if (!map.hasImage(id)) {
        const halo = state === "selected" ? PIN.halo : null;
        map.addImage(id, pinImage(PIN[state], halo), { pixelRatio: PIN_DPR });
      }
    }

    map.addSource("sites", {
      type: "geojson",
      data: currentData,
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
        "icon-image": PIN_IMAGE.base,
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
        "icon-image": PIN_IMAGE.selected,
        "icon-size": fixedSize(1.25),
        "icon-anchor": "bottom",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    });

    for (const name of [...(cluster ? ["clusters"] : []), ...POINT_LAYERS]) {
      map.on("mouseenter", name, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", name, () => { map.getCanvas().style.cursor = ""; });
    }

    if (cluster) map.on("click", "clusters", (e) => {
      const feature = e.features && e.features[0];
      if (!feature) return;
      const count = feature.properties.point_count;
      const source = map.getSource("sites");
      Promise.resolve(source.getClusterExpansionZoom(feature.properties.cluster_id))
        .then((zoom) => map.easeTo({ center: feature.geometry.coordinates, zoom }))
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
    while (pending.length) pending.shift()();
  });

  function fitToIds(ids, duration) {
    const list = (ids && ids.length ? ids.map((i) => byId.get(i)) : [...byId.values()])
      .filter(Boolean);
    if (!list.length) return;
    if (list.length === 1) {
      map.easeTo({ center: list[0].geometry.coordinates, zoom: 15, duration });
      return;
    }
    const b = new maplibregl.LngLatBounds();
    for (const f of list) b.extend(f.geometry.coordinates);
    map.fitBounds(b, { padding: 60, maxZoom: 15, duration });
  }

  // Where the camera puts a selected pin, as MapLibre's `offset` from the container's
  // centre. The core does not know what surrounds its container — a list beside it, a
  // card over it — so the client says where the pin should land and the core only does
  // the arithmetic. No `focusPoint` means the container's own centre.
  function focusOffset() {
    const point = focusPoint ? focusPoint() : null;
    if (!point) return [0, 0];
    const box = map.getContainer().getBoundingClientRect();
    return [point[0] - box.width / 2, point[1] - box.height / 2];
  }

  function applySelection(id, via) {
    const previous = byId.get(selectedId) || null;
    selectedId = id;
    repaint();
    const feature = byId.get(id) || null;
    if (feature) {
      const [lon, lat] = feature.geometry.coordinates;
      // A map click needs no camera move — the user is already looking at the pin. A
      // selection from the list does, because the pin may be off screen. Stepping between
      // two records at one location needs none while they are drawn within a pin's reach
      // of each other: the camera is already there, and a lurch on every step would say
      // the map had gone somewhere when it had not. Measured in pixels rather than metres
      // because it is a question about what is on screen, which is the core's business;
      // what counts as one *place* is the client's, and it decides that in metres.
      const from = previous ? map.project(previous.geometry.coordinates) : null;
      const to = map.project([lon, lat]);
      const alreadyThere = from && Math.hypot(to.x - from.x, to.y - from.y) < 60;
      if (via !== "map" && !alreadyThere) {
        map.easeTo({
          center: [lon, lat],
          zoom: Math.max(map.getZoom(), 15),
          duration: 700,
          offset: focusOffset(),
        });
      }
    }
    onSelect(feature, { via });
  }

  // ------------------------------------------------------------------ public API
  const api = {
    /** The underlying MapLibre instance. Escape hatch — prefer the methods below. */
    get raw() { return map; },

    setData(geojson) {
      currentData = geojson || EMPTY;
      indexData(currentData);
      whenReady(() => {
        map.getSource("sites").setData(currentData);
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

    /** Read-only view of what is selected. */
    get selectedId() { return selectedId; },

    /** Speak through the map's live region. Takes a string or a DOM node. */
    announce,

    /** Resolve once the style and layers are up — used for the map_load event. */
    ready(fn) { whenReady(fn); return api; },

    destroy() {
      destroyed = true;
      try { map.remove(); } catch (_) { /* already gone */ }
      liveRegion.remove();
    },
  };

  return api;
}

export { PIN, CLUSTER_MAX_ZOOM, NYC_BOUNDS, track };
