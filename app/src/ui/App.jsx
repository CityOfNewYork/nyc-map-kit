/**
 * App.jsx — the block: the list, the map, and the card either of them opens.
 *
 * App owns what is selected and everything that follows from a selection: the address
 * bar, the modal, focus, and the small map in the card. The components under it are
 * markup. The maps are only ever touched through map-core's API (core/map-core.js), so
 * the map half of the block can be reused without any of this.
 *
 * TWO RULES THIS FILE AND ITS COMPONENTS KEEP:
 *
 * 1. LANGUAGE. nyc.gov is translated by a proxy that rewrites DOM text nodes. So every
 *    visible string is a text node inside its own element, and a label is never glued to
 *    a value to make one string — <span>Phone</span> next to <span>{number}</span>,
 *    never `"Phone: " + number`. Screen-reader-only copy is a visually-hidden <span>,
 *    not an aria-label, because the proxy cannot see attribute values. There are no
 *    string files and no i18n library; the only language logic in the block is the
 *    basemap's, in core/basemap-style.js.
 *
 *    The same rule keeps React and a translator out of each other's way. A translator
 *    working in the browser (Chrome's, or a proxy's script for text that changes after
 *    load) swaps text nodes for elements of its own. When a string is the ONLY child of
 *    its element, React changes it by replacing the element's whole content, so a swapped
 *    node cannot be left behind showing the previous value. Text sitting next to other
 *    children — `<p>Hours: {hours}</p>` — is edited in place, and is what goes stale or
 *    crashes under a translator. Keep each changing string alone in its own element.
 *
 * 2. ACCESSIBILITY. The list is the text alternative to the map. Every site the map
 *    draws is reachable from it by keyboard, selection moves focus to the card, and
 *    closing the card puts focus back where it came from.
 */
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import {
  addLandcoverParks, balancePlaceLabels, loadBasemapStyle, warmTint,
} from "../core/basemap-style.js";
import { track } from "../logic/analytics.js";
import { coincidentWith, prepareData } from "../logic/data.js";
import { Panel } from "./Panel.jsx";
import { SiteDialog } from "./SiteDialog.jsx";
import { useMapCore } from "./useMapCore.js";

const BASEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

/**
 * Water and parks get real, if quiet, colour. Positron draws both as greys a few steps
 * from the land, which is faithful to its brief as a background but leaves a resident
 * with no landmarks: the East River and Prospect Park are what tell someone which part
 * of the city they are looking at. Both stay well below the pins in saturation, so the
 * data is still the loudest thing on the map.
 */
const BASEMAP_PALETTE = {
  water: "hsl(202, 42%, 80%)",
  park:  "hsl(96, 30%, 84%)",
};

/** The heading until config.json or `?title=` names the map. */
const DEFAULT_TITLE = "SNAP volunteer opportunities";

/** On a desktop the list floats over the map's left edge (see .panel in style.css), so
 *  the camera's centre moves right by the list's width plus its 10 px inset either side. */
const LIST_PADDING = 340;

/** Street level, a little closer than the main map's: the card's map answers "where is
 *  this" for one place, not "what is near me". */
const MINI_MAP_ZOOM = 15.5;

export default function App({ settings }) {
  const [model, setModel] = useState(null);      // config.json + the prepared data
  const [basemap, setBasemap] = useState(null);  // the basemap style, once fetched
  const [failed, setFailed] = useState(false);
  // The site whose card is open. `seq` counts selections, so selecting a site again (Back
  // to it, say) still runs the effect that opens and focuses the card.
  const [selection, setSelection] = useState({ feature: null, seq: 0 });

  const main = useMapCore();
  const mini = useMapCore();                     // the map in the card; made on first open
  const dialogRef = useRef(null);

  // Bookkeeping that event handlers read and write but nothing renders: refs, not state.
  const selectedId = useRef(null);     // what map-core has selected, readable at once
  const stepFocus = useRef(null);      // "prev"/"next" while a stepper click is in flight
  const returnFocusTo = useRef(null);  // the control that opened the card
  const pushed = useRef(false);        // the open card has a history entry of its own
  const urlDriven = useRef(false);     // the URL, not the reader, chose the site

  // ------------------------------------------------------------------------- loading

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const loaded = await loadData(settings);
      if (cancelled) return;
      setModel(loaded);                // the list can render while the basemap loads
      const style = await loadBasemap(settings.lang);
      if (!cancelled) setBasemap(style);
    }
    load().catch((err) => {
      if (cancelled) return;
      console.error(err);
      setFailed(true);
    });
    return () => { cancelled = true; };
  }, [settings]);

  const title = model ? settings.title || model.config.title : null;
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);

  // ------------------------------------------------------------------------ the maps

  // The map calls back on every selection, and must always reach this render's handler.
  const onMapSelect = useEffectEvent((feature, info) => handleSelect(feature, info));

  useEffect(() => {
    if (!model || !basemap) return;
    let map;
    try {
      map = main.create({
        style: structuredClone(basemap),
        data: model.data,
        onSelect: (feature, info) => onMapSelect(feature, info),
        onClusterExpand: () => {},
      });
    } catch (err) {
      console.error(err);
      // MapLibre could not start (no WebGL, say): show the error note, not a blank frame.
      // eslint-disable-next-line react/set-state-in-effect -- reporting the external system's failure
      setFailed(true);
      return;
    }

    // Set before the style loads, so the first framing already accounts for the list.
    const desktop = matchMedia("(min-width: 768px)");
    const padForList = () => map.raw.setPadding({ left: desktop.matches ? LIST_PADDING : 0 });
    if (settings.list !== "off") {
      padForList();
      desktop.addEventListener("change", padForList);
    }

    // A deliberate global. It is the debugging surface for this prototype — open the
    // console on any page that embeds the block and you can drive the map by hand:
    //   nycMapKit.select("henry-street-settlement-1")
    //   nycMapKit.highlight([...])          nycMapKit.raw   // the MapLibre instance
    // It exposes only the map-core API, never the app's internals.
    window.nycMapKit = map;

    map.ready(() => track("map_load", {
      sites: model.features.length,
      orgs: model.orgs.length,
      lang: settings.lang,
    }));

    // A link with ?site= opens on that site's card.
    if (settings.site && model.byId.has(settings.site)) {
      urlDriven.current = true;
      map.select(settings.site);
    }

    return () => {
      desktop.removeEventListener("change", padForList);
      main.destroy();
    };
  }, [model, basemap, settings, main]);

  useEffect(() => mini.destroy, [mini]);

  // ---------------------------------------------------------------------- selection

  /** map-core's onSelect: the one place a selection lands, however it was made. */
  function handleSelect(feature, info) {
    if (!feature) {
      selectedId.current = null;
      setSelection((s) => (s.feature ? { feature: null, seq: s.seq } : s));
      return;
    }
    const p = feature.properties;
    selectedId.current = p.id;
    recordInUrl(p.id);
    setSelection((s) => ({ feature, seq: s.seq + 1 }));
    announceSelected(main.mapRef.current, p);
    if (info.via === "map") {
      returnFocusTo.current = null;
      track("map_pin_open", { org_id: p.org_id, site_id: p.id, via: "map" });
    }
  }

  // After a selection renders: open the modal, show the place on the card's map, and move
  // focus. Runs as a layout effect so focus moves before the browser paints.
  const showCard = useEffectEvent((feature) => {
    const dialog = dialogRef.current;
    if (!dialog.open) dialog.showModal();

    // The small map at the top of the card: where this place is, at street level, with
    // the sites around it. It is the same map-core as the main map, so its pins look and
    // behave the same — tapping another pin here opens that site's card in place.
    // Scroll-to-zoom is off because the wheel belongs to the card's text; the zoom
    // buttons and dragging stay.
    let miniMap = mini.mapRef.current;
    if (!miniMap) {
      miniMap = mini.create({
        style: structuredClone(basemap),
        data: model.data,
        onSelect: (picked, info) => {
          if (info.via === "map" && picked && picked.properties.id !== selectedId.current) {
            main.mapRef.current.select(picked.properties.id);
            track("map_pin_open", {
              org_id: picked.properties.org_id, site_id: picked.properties.id, via: "mini_map",
            });
          }
        },
      });
      miniMap.raw.scrollZoom.disable();
      // MapLibre opens the compact attribution expanded until the first drag; on a map
      // this small it would cover the bottom third. Collapsed, it is the (i) button.
      miniMap.ready(() => miniMap.raw.getContainer()
        .querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show"));
    }
    // The dialog was display:none until a moment ago; the canvas has to measure again.
    miniMap.raw.resize();
    miniMap.ready(() => {
      miniMap.raw.jumpTo({ center: feature.geometry.coordinates, zoom: MINI_MAP_ZOOM });
      miniMap.select(feature.properties.id);
    });

    // Focus the card's heading so a keyboard or screen-reader user lands on the content
    // they just asked for instead of being left behind in the list. The exception is a
    // stepper click: focus goes back to the arrow they pressed, so a second press steps
    // again.
    const arrow = stepFocus.current && dialog.querySelector(`.step-${stepFocus.current}`);
    stepFocus.current = null;
    (arrow || dialog.querySelector("#card-title")).focus();
  });

  useLayoutEffect(() => {
    if (selection.feature) showCard(selection.feature);
  }, [selection]);

  function openFromList(button, feature) {
    const map = main.mapRef.current;
    if (!map) return;                  // the list is up before the map is
    returnFocusTo.current = button;
    map.select(feature.properties.id);
    track("map_pin_open", {
      org_id: feature.properties.org_id, site_id: feature.properties.id, via: "list",
    });
  }

  /** Step to the previous (-1) or next (+1) record in this group, wrapping round. */
  function step(delta, dir) {
    const group = coincidentWith(model.atCoord, selection.feature);
    const index = group.findIndex((f) => f.properties.id === selection.feature.properties.id);
    const next = group[(index + delta + group.length) % group.length];
    stepFocus.current = dir;
    // Re-select through the core so the map's own state moves with the card.
    main.mapRef.current.select(next.properties.id);
    track("map_pin_open", {
      org_id: next.properties.org_id, site_id: next.properties.id, via: "stepper",
    });
  }

  // ------------------------------------------------------------- the card's address

  /*
   * Opening a card from the map or the list adds a history entry with ?site=<id>, so the
   * card has an address that can be shared, and the browser's Back button — the one a
   * phone user reaches for — closes the card instead of leaving the page. Every way of
   * closing it (the × button, Escape, a click on the blurred map) goes back through that
   * same entry, so the history never collects a trail of closed cards.
   *
   * Moving between cards while one is open (the stepper, or a pin on the small map)
   * replaces the entry instead of adding one: Back closes the card, whichever site it has
   * reached, rather than stepping back through each one.
   *
   * Inside an iframe the address that changes is the frame's, not the host page's, so the
   * link is embed.html?site=<id>. Back still works, because the browser keeps one history
   * for the page and its frames.
   */

  /** Put the selected site in the address bar: a new entry when a card opens, else in place. */
  function recordInUrl(id) {
    if (urlDriven.current) {
      urlDriven.current = false;       // the address already says so
      return;
    }
    if (dialogRef.current.open) {
      history.replaceState(history.state, "", siteUrl(id));
    } else {
      history.pushState({ mapkitSite: id }, "", siteUrl(id));
      pushed.current = true;
    }
  }

  /** Close the card. If it has its own history entry, close it by going back. */
  function closeCard() {
    if (pushed.current) {
      history.back();                  // popstate finds no ?site= and calls hideCard
      return;
    }
    hideCard();
    history.replaceState(history.state, "", siteUrl(null));
  }

  function hideCard() {
    pushed.current = false;
    if (dialogRef.current.open) dialogRef.current.close();
    if (main.mapRef.current) main.mapRef.current.select(null);   // clears the selection
    const back = returnFocusTo.current;
    returnFocusTo.current = null;
    if (back && document.contains(back)) back.focus();
  }

  const onPopState = useEffectEvent(() => {
    const map = main.mapRef.current;
    if (!map) return;
    const id = new URLSearchParams(window.location.search).get("site");
    if (id && model.byId.has(id)) {
      urlDriven.current = true;
      map.select(id);
      pushed.current = Boolean(history.state && history.state.mapkitSite);
    } else if (dialogRef.current.open) {
      hideCard();
    }
  });

  useEffect(() => {
    const listener = () => onPopState();
    window.addEventListener("popstate", listener);
    return () => window.removeEventListener("popstate", listener);
  }, []);

  // ------------------------------------------------------------------------- render

  const feature = selection.feature;
  return (
    <>
      {/*
        The heading is in the markup but not on the screen. The block is an iframe inside a
        nyc.gov page that already has its own <h1> naming what the page is about, so
        drawing the name a second time at the top of the map spent a line of vertical
        space telling the resident something they had just read.

        It stays in the DOM, visually hidden, because it is doing three jobs that have
        nothing to do with being seen: it is the block's only <h1>, so removing it would
        leave an iframe whose document has no heading outline at all; it is what a screen
        reader announces on entering the frame, which is the only way a non-sighted user
        learns what the frame contains; and it is the landmark the list and map sit under.
      */}
      <header className="block-header">
        <h1 id="block-title" className="visually-hidden">{title || DEFAULT_TITLE}</h1>
      </header>

      {/*
        185 sites is 185 tab stops before a keyboard user reaches the map's own controls.
        This is the standard escape hatch: invisible until it takes focus, first in the tab
        order, and it lands on the map container.
      */}
      <a className="skip-link" href="#map">Skip the list and go to the map</a>

      <div className="stage" id="stage" data-list={model ? settings.list : "on"}>
        <Panel model={model} list={settings.list}
               selectedId={feature && feature.properties.id} onOpen={openFromList} />
        {/* map-core fills this div; React only puts the loading and error notes in it. */}
        <div className="map" id="map" tabIndex={-1} ref={main.containerRef}>
          {failed ? (
            <p className="load-error" id="loading"><span>The map could not load its data.</span></p>
          ) : !basemap && (
            <p className="loading" id="loading"><span>Loading the map…</span></p>
          )}
        </div>
      </div>

      <SiteDialog ref={dialogRef} miniMapRef={mini.containerRef}
                  feature={feature}
                  group={feature ? coincidentWith(model.atCoord, feature) : []}
                  model={model} lang={settings.lang}
                  onStep={step} onClose={closeCard} />
    </>
  );
}

// ---------------------------------------------------------------------------- loading

async function fetchJson(url, fallback) {
  try {
    const resp = await fetch(url);
    // A missing orgs.json is a supported configuration, not a failure: the block falls
    // back to grouping the features by their `org` property.
    if (!resp.ok) return fallback;
    return await resp.json();
  } catch (err) {
    console.warn(`[embed] could not load ${url}: ${err.message}`);
    return fallback;
  }
}

/** config.json, the point data and orgs.json, shaped by logic/data.js. */
async function loadData(settings) {
  const [config, data, orgsDoc] = await Promise.all([
    fetchJson("config.json", {}),
    fetchJson(settings.data, null),
    fetchJson(settings.orgs, null),
  ]);
  if (!data || !Array.isArray(data.features)) {
    throw new Error(`no point data at ${settings.data.pathname}`);
  }
  const cfg = config || {};
  return { config: cfg, data, ...prepareData(cfg, data, orgsDoc) };
}

/** The basemap style, with its labels in the reader's language. See basemap-style.js. */
async function loadBasemap(lang) {
  const style = await loadBasemapStyle(BASEMAP_STYLE, lang);
  return warmTint(balancePlaceLabels(addLandcoverParks(style), lang), BASEMAP_PALETTE);
}

// ------------------------------------------------------------------------ live region

/**
 * Announce a selection through the one live region map-core owns. Built as DOM nodes,
 * each string in its own element, because the region sits inside the map's container,
 * outside anything React renders — and the translation proxy has to reach it too.
 */
function announceSelected(map, p) {
  if (!map) return;
  const span = (text) => Object.assign(document.createElement("span"), { textContent: text });
  const line = document.createElement("p");
  line.append(span("Selected"), ": ", span(p.org), ", ", span(p.address));
  map.announce(line);
}

function siteUrl(id) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("site", id);
  else url.searchParams.delete("site");
  return url;
}
