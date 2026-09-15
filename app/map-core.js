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
 *     onSelect(feature, info),       // info = {via, coincident}
 *     onClusterExpand(count),
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
 * COINCIDENT ADDRESSES. Several organizations list the same building. Clustering hides
 * that below zoom 14 and stacking hides it above. So when a click lands on a spot where
 * two or more sites share a coordinate, `onSelect` is called with the first feature and
 * `info.coincident` set to all of them; the client renders the chooser (it is visible
 * text, so it has to be the client's DOM to stay translatable) and calls `select()` for
 * whichever the user picks.
 *
 * MapLibre is loaded as an ES module from a CDN. v6 ships no UMD build, so there is no
 * `<script src>`+global form of this any more; native `import` is the no-build path.
 * See README §Swapping a layer for self-hosting it.
 */

import * as maplibregl from "https://cdn.jsdelivr.net/npm/maplibre-gl@6.8.0/dist/maplibre-gl.mjs";

// --------------------------------------------------------------------------- appearance
// Marks, not text, so the bar is WCAG 2.2 SC 1.4.11 non-text contrast (3:1) against the
// positron basemap and against each other — not the 4.5:1 text ratio.
const PIN = {
  base: "#1d4ed8",        // blue-700 on a near-white basemap
  dimmed: "#94a3b8",      // slate-400 — "still here, not what you asked about"
  selected: "#b91c1c",    // red-700 — the one you are looking at
  cluster: "#1d4ed8",
  stroke: "#ffffff",
};
const CLUSTER_MAX_ZOOM = 14;   // above this, points render individually and can stack
const CLUSTER_RADIUS = 40;
const NYC_BOUNDS = [[-74.30, 40.47], [-73.65, 40.95]];

// A value no real site id can equal, so "nothing is selected" is expressible inside a
// MapLibre expression (which has no notion of null).
const NO_SELECTION = "∅";

const EMPTY = { type: "FeatureCollection", features: [] };

// The three layers that draw individual sites (as opposed to cluster bubbles). A click
// anywhere in this set is a click on a site, and a coincident-address query has to look
// at all three or the answer depends on which one happens to be on top.
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
    onSelect = () => {},
    onClusterExpand = () => {},
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

  function sitesColor() {
    if (!highlighted.length) return ["case", isSelected(), PIN.selected, PIN.base];
    return PIN.dimmed;            // the highlighted ones are drawn by the overlay instead
  }
  function sitesRadius() {
    return highlighted.length ? 4 : ["case", isSelected(), 9, 6];
  }
  function sitesOpacity() {
    return highlighted.length ? 0.45 : 0.95;
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
    map.setPaintProperty("sites", "circle-color", sitesColor());
    map.setPaintProperty("sites", "circle-radius", sitesRadius());
    map.setPaintProperty("sites", "circle-opacity", sitesOpacity());
    map.setPaintProperty("clusters", "circle-opacity", highlighted.length ? 0.35 : 0.9);
    map.setPaintProperty("cluster-count", "text-opacity", highlighted.length ? 0.5 : 1);
    map.getSource("overlay").setData(subset(highlighted));
    map.getSource("focus").setData(subset(selectedId ? [selectedId] : []));
  }

  // ------------------------------------------------------------------ layers
  map.on("load", () => {
    if (destroyed) return;
    map.addSource("sites", {
      type: "geojson",
      data: currentData,
      cluster: true,
      clusterRadius: CLUSTER_RADIUS,
      // Deliberately below maxZoom: past this zoom every point draws on its own, which
      // is what lets two sites at one address stack and be caught by the chooser.
      clusterMaxZoom: CLUSTER_MAX_ZOOM,
    });

    map.addLayer({
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
    map.addLayer({
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
      type: "circle",
      source: "sites",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": sitesColor(),
        "circle-radius": sitesRadius(),
        "circle-opacity": sitesOpacity(),
        "circle-stroke-width": 1.5,
        "circle-stroke-color": PIN.stroke,
      },
    });

    // The highlighted organization's sites, drawn unclustered over the dimmed base.
    map.addSource("overlay", { type: "geojson", data: EMPTY });
    map.addLayer({
      id: "overlay-sites",
      type: "circle",
      source: "overlay",
      paint: {
        "circle-color": PIN.base,
        "circle-radius": 7,
        "circle-stroke-width": 2,
        "circle-stroke-color": PIN.stroke,
      },
    });

    // The one selected site, always on top and always visible.
    map.addSource("focus", { type: "geojson", data: EMPTY });
    map.addLayer({
      id: "focus-site",
      type: "circle",
      source: "focus",
      paint: {
        "circle-color": PIN.selected,
        "circle-radius": 10,
        "circle-stroke-width": 3,
        "circle-stroke-color": PIN.stroke,
      },
    });

    for (const name of ["clusters", ...POINT_LAYERS]) {
      map.on("mouseenter", name, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", name, () => { map.getCanvas().style.cursor = ""; });
    }

    map.on("click", "clusters", (e) => {
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
        const hits = coincidentAt(e.point, e.features && e.features[0]);
        if (!hits.length) return;
        applySelection(hits[0].properties.id, "map", hits.length > 1 ? hits : null);
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

  /**
   * Every site rendered under this click, nearest first. Two sites at one address are
   * drawn at the same pixel, so a click returns both and only the top one would ever be
   * reachable without this.
   */
  function coincidentAt(point, first) {
    const box = [
      [point.x - 6, point.y - 6],
      [point.x + 6, point.y + 6],
    ];
    const found = map.queryRenderedFeatures(box, { layers: POINT_LAYERS });
    const seen = new Set();
    const out = [];
    if (first && first.properties && first.properties.id) {
      seen.add(first.properties.id);
      out.push(byId.get(first.properties.id) || first);
    }
    for (const f of found) {
      const id = f.properties && f.properties.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(byId.get(id) || f);
    }
    return out;
  }

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

  function applySelection(id, via, coincident) {
    selectedId = id;
    repaint();
    const feature = byId.get(id) || null;
    if (feature) {
      const [lon, lat] = feature.geometry.coordinates;
      // A map click needs no camera move — the user is already looking at the pin. A
      // selection from the list does, because the pin may be off screen.
      if (via !== "map") {
        map.easeTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 15), duration: 700 });
      }
    }
    onSelect(feature, { via, coincident: coincident || null });
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
        onSelect(null, { via: "api", coincident: null });
        return api;
      }
      whenReady(() => applySelection(id, "api", null));
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
