/**
 * embed.js — the first client of map-core.js.
 *
 * Everything dataset-shaped lives here: URL parameters, the organization list, the card,
 * the bottom sheet, focus management, and the analytics events that mention orgs. The
 * map itself is only ever touched through the five methods map-core exposes
 * (`setData` / `select` / `highlight` / `fitTo` / `destroy`), which is what proves that
 * API is enough for a second client to be written against it.
 *
 * TWO RULES THIS FILE KEEPS, both explained at length in the README:
 *
 * 1. LANGUAGE. nyc.gov is translated by a proxy that rewrites DOM text nodes. So every
 *    visible string is a text node inside its own element, and a label is never glued to
 *    a value to make one string — `el("span", "Phone")` next to `el("span", number)`,
 *    never `"Phone: " + number`. Screen-reader-only copy is a visually-hidden <span>,
 *    not an aria-label, because the proxy cannot see attribute values. There are no
 *    string files and no i18n library; the only language logic in the block is the
 *    basemap's, in basemap-style.js.
 *
 * 2. ACCESSIBILITY. The list is the text alternative to the map. Every site the map
 *    draws is reachable from it by keyboard, selection moves focus to the card, and
 *    closing the card puts focus back where it came from.
 */

import { createMap } from "./core/map-core.js";
import { addLandcoverParks, balancePlaceLabels, loadBasemapStyle, resolveLang, warmTint }
  from "./core/basemap-style.js";
import { track } from "./logic/analytics.js";
import { cardActions, cardFields, displayUrl, formatDate, hrefFor, mapsLink, parseStructure, telHref }
  from "./logic/card.js";
import { coincidentWith, compareSites, prepareData } from "./logic/data.js";
import { readSettings } from "./logic/params.js";
// After map-core, which brings MapLibre's stylesheet, so these rules win where they overlap.
import "./style.css";

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

// ---------------------------------------------------------------------------- helpers

/** Build an element. Children are strings (become text nodes) or nodes. */
function el(tag, ...children) {
  const node = document.createElement(tag);
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
/** A <span> holding one string. The unit of translatable text in this app. */
const span = (text, className) => {
  const s = el("span", text);
  if (className) s.className = className;
  return s;
};
const hidden = (text) => span(text, "visually-hidden");

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------------- parameters

const settings = readSettings(window.location.search, document.baseURI, window.location.origin);
settings.lang = resolveLang(settings.lang);

// The proxy reads <html lang> to decide what it is translating from, and
// basemap-style.js reads it to pick the basemap's label language.
document.documentElement.lang = settings.lang;

// --------------------------------------------------------------------------- app state

const state = {
  config: null,
  features: [],
  byId: new Map(),
  orgs: [],
  orgById: new Map(),
  /** Site id -> every feature at that location. See indexByLocation. */
  atCoord: new Map(),
  /** Set to "prev"/"next" while a stepper click is in flight, so focus follows the arrow
   *  instead of jumping back to the card heading on every step. */
  stepFocus: null,
  generated: "",
  selectedId: null,
  /** The control that caused the current selection, so Escape can return focus to it. */
  returnFocusTo: null,
  /** True while the open card has a history entry of its own, so closing it is Back. */
  pushed: false,
  /** Set when the URL, not the reader, chose the site: the address already says so. */
  urlDriven: false,
};

let map = null;
/** The small map at the top of the card. Made the first time a card opens. */
let miniMap = null;
/** What the mini map is built from: the same basemap and points as the main one. */
let mapInputs = null;

// ------------------------------------------------------------------------------- boot

boot().catch(showFatal);

async function boot() {
  const [config, data, orgsDoc] = await Promise.all([
    fetchJson("config.json", {}),
    fetchJson(settings.data, null),
    fetchJson(settings.orgs, null),
  ]);
  if (!data || !Array.isArray(data.features)) {
    throw new Error(`no point data at ${settings.data.pathname}`);
  }

  state.config = config || {};
  Object.assign(state, prepareData(state.config, data, orgsDoc));

  applyTitle();
  renderCounts();
  renderList();
  setupSheet();

  const style = warmTint(
    balancePlaceLabels(
      addLandcoverParks(await loadBasemapStyle(BASEMAP_STYLE, settings.lang)),
      settings.lang),
    BASEMAP_PALETTE);
  $("loading").remove();
  mapInputs = { style, data };

  map = createMap($("map"), {
    style: structuredClone(style),
    data,
    onSelect: handleSelect,
    onClusterExpand: () => {},
  });

  // On a desktop the list floats over the map's left edge (see .panel in style.css), so
  // the camera's centre moves right by the list's width plus its 10 px inset either side.
  // Set before the style loads, so the first framing already accounts for it.
  if (settings.list !== "off") {
    const desktop = matchMedia("(min-width: 768px)");
    const padForList = () => map.raw.setPadding({ left: desktop.matches ? 340 : 0 });
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
    sites: state.features.length,
    orgs: state.orgs.length,
    lang: settings.lang,
  }));

  setupDialog();

  // A link with ?site= opens on that site's card.
  if (settings.site && state.byId.has(settings.site)) {
    state.urlDriven = true;
    map.select(settings.site);
  }
}

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

function showFatal(err) {
  console.error(err);
  const box = $("loading") || $("map");
  box.className = "load-error";
  box.replaceChildren(el("p", span("The map could not load its data.")));
}

// ------------------------------------------------------------------------------ chrome

function applyTitle() {
  const title = settings.title || state.config.title;
  if (!title) return;
  $("block-title").replaceChildren(document.createTextNode(title));
  document.title = title;
}

/** Fill one count and pick between the singular and plural noun that follow it. Both
 *  nouns are in embed.html; see the comment there for why they are not built in code. */
function setCount(id, n) {
  $(id).textContent = String(n);
  for (const el of document.querySelectorAll(`[data-plural="${id}"]`)) el.hidden = n === 1;
  for (const el of document.querySelectorAll(`[data-singular="${id}"]`)) el.hidden = n !== 1;
}

function renderCounts() {
  setCount("sheet-orgs", state.orgs.length);
  setCount("sheet-sites", state.features.length);
  $("stage").dataset.list = settings.list;
}

// -------------------------------------------------------------------------------- list

/**
 * One row per site. Not per organization.
 *
 * The list used to be organizations, with the multi-site ones expanding to reveal their
 * sites. That made a row mean two different things depending on which organization it
 * named — "Aempowerments Global Foundation Inc." opened a card, "A Blend of Services ·
 * 2 sites" expanded a sublist — and the only tells were a blank chevron and a missing
 * count, both of which are absences rather than signals.
 *
 * Flat is the version with nothing to learn: every row is one site and opens one card,
 * the same card the pin opens. The cost is 60 consecutive rows reading "Acacia Housing
 * and Preservation", which is why the address is a second line rather than a tooltip —
 * it is what makes each row its own place.
 *
 * Sorted north to south, borough by borough — see `compareSites` in logic/data.js.
 */
function renderList() {
  if (settings.list === "off") return;
  const list = $("site-list");
  list.replaceChildren();

  const sites = state.features.slice().sort(compareSites);

  for (const feature of sites) {
    const p = feature.properties;
    const button = el("button");
    button.type = "button";
    button.className = "site-button";
    button.dataset.siteId = p.id;
    // The borough is already inside the address string, so a row is two lines, not three.
    button.append(span(p.org, "name"), span(p.address, "addr"));
    button.addEventListener("click", () => {
      state.returnFocusTo = button;
      map.select(p.id);
      track("map_pin_open", { org_id: p.org_id, site_id: p.id, via: "list" });
    });
    list.append(el("li", button));
  }
}

/** Mark the list row that corresponds to the current selection, and clear the others. */
function markCurrent(siteId) {
  if (settings.list === "off") return;
  for (const b of $("site-list").querySelectorAll(".site-button")) {
    if (b.dataset.siteId === siteId) b.setAttribute("aria-current", "true");
    else b.removeAttribute("aria-current");
  }
}

// -------------------------------------------------------------------------------- card

function handleSelect(feature, info) {
  if (!feature) {
    state.selectedId = null;
    markCurrent(null);
    return;
  }
  state.selectedId = feature.properties.id;
  markCurrent(state.selectedId);
  recordInUrl(state.selectedId);
  renderCard(feature);
  announce([span("Selected"), ": ", span(feature.properties.org), ", ",
            span(feature.properties.address)]);

  if (info.via === "map") {
    state.returnFocusTo = null;
    track("map_pin_open", {
      org_id: feature.properties.org_id,
      site_id: feature.properties.id,
      via: "map",
    });
  }
  // Focus the card's heading so a keyboard or screen-reader user lands on the content
  // they just asked for instead of being left behind in the list. The exception is a
  // stepper click: the card is rebuilt under the user's finger, so focus goes back to the
  // arrow they pressed and a second press steps again.
  const arrow = state.stepFocus
    ? $("stepper").querySelector(`.step-${state.stepFocus}`)
    : null;
  state.stepFocus = null;
  (arrow || $("card-title")).focus();
}

function renderCard(feature) {
  const p = feature.properties;
  const org = state.orgById.get(p.org_id) || {};
  const card = $("card");
  card.replaceChildren();

  // The stepper is a sibling of the card, not part of it: chrome for reaching the other
  // record at this location, kept out of the record itself.
  renderStepper(coincidentWith(state.atCoord, feature), p.id);

  const title = el("h2", p.org);
  title.id = "card-title";
  title.tabIndex = -1;
  card.append(title);

  const where = el("p");
  where.className = "where";
  where.append(span(p.address, "addr"));
  if (p.borough) where.append(span(p.borough, "boro"));
  card.append(where);

  const actions = actionRow(feature, org);
  if (actions) card.append(actions);

  const dl = el("dl");
  for (const field of cardFields(state.config, p, org)) {
    dl.append(el("dt", span(field.label)));
    dl.append(el("dd", renderValue(field, field.value)));
  }
  if (dl.children.length) card.append(dl);

  if (state.generated) {
    const footer = el("p", span("Data updated"), " ", stamp(state.generated));
    footer.className = "card-footer";
    card.append(footer);
  }

  card.hidden = false;
  openDialog(feature);
}

/**
 * Call, website, and a link out to Google Maps — the row directly under the address.
 *
 * These are the three things a resident opening a card is most likely to have come for,
 * and they used to be scattered: the phone number and the website were two rows of the
 * definition list, below "Hours" and above four fields of programme prose, and the map
 * link was at the very bottom of the card. Doing anything with a site meant reading past
 * everything describing it first.
 *
 * Which fields appear is config, not code — `actions` in config.json, in the order the
 * card should show them — so a different dataset moves its own fields up here without
 * touching this file. The Google Maps link is appended last and is the one composed
 * rather than read from a single field — see `mapsLink` in logic/card.js.
 *
 * Each button carries a label and a detail line: the label is the verb, the detail is the
 * information. That keeps the phone number and the domain visible and copyable on a
 * desktop, where `tel:` does nothing, without the row turning into an icon puzzle. Both
 * are separate text nodes, so the proxy translates the verb and leaves the number alone.
 */
function actionRow(feature, org) {
  const p = feature.properties;
  const box = el("div");
  box.className = "actions";

  for (const action of cardActions(state.config, p, org)) {
    const link = el("a", span(action.label, "action-label"), span(action.detail, "action-detail"));
    link.className = "action";
    link.href = action.href;
    if (action.external) {
      link.target = "_blank";
      link.rel = "noopener";
    }
    link.addEventListener("click", () => track("map_action_click", {
      org_id: p.org_id, site_id: p.id, action: action.key,
    }));
    box.append(link);
  }

  const maps = mapsLink(state.config, feature, org);
  if (maps) {
    const link = el("a", span("Open in Google Maps", "action-label"),
                       span("see this location on a full map", "action-detail"));
    link.className = "action";
    link.href = maps;
    link.target = "_blank";
    link.rel = "noopener";
    link.addEventListener("click", () => track("map_open_in_maps_click", {
      org_id: p.org_id, site_id: p.id,
    }));
    box.append(link);
  }

  return box.children.length ? box : null;
}

function stamp(iso) {
  const time = el("time");
  time.dateTime = iso;
  time.textContent = formatDate(iso, settings.lang);
  return time;
}

/** A field value's structure (see `parseStructure` in logic/card.js) as elements. */
function structure(value) {
  const s = parseStructure(value);
  const list = (items) => {
    const ul = el("ul");
    for (const item of items) ul.append(el("li", span(item)));
    return ul;
  };
  if (s.kind === "intro-list") return [el("p", span(s.intro)), list(s.items)];
  if (s.kind === "paragraphs") return s.items.map((line) => el("p", span(line)));
  if (s.kind === "list") return [list(s.items)];
  return [span(s.text)];
}

function renderValue(field, value) {
  if (field.as === "url") {
    const a = el("a", span(displayUrl(value)));
    a.href = hrefFor(value);
    a.target = "_blank";
    a.rel = "noopener";
    return a;
  }
  if (field.as === "tel") {
    const a = el("a", span(value));
    a.href = telHref(value);
    return a;
  }
  return structure(value);
}

/**
 * More than one record on this exact coordinate: step between them, one card at a time.
 *
 * A stepper rather than a list, because a card has to stay atomic. The list this replaced
 * put N organizations' names inside one organization's card — unbounded height, and at
 * city zoom it was listing pixel neighbours a kilometre away as though they shared an
 * address. A stepper is two arrows and a count: constant height whatever the stack depth,
 * and the card below it is always exactly one site.
 *
 * The count is the part Felt's version omits and ArcGIS's includes, and it is the part
 * that matters — without it there is no way to know a second record is there at all.
 *
 * It wraps rather than disabling at the ends. With a stack of two, disabling would leave
 * one of the two arrows permanently dead; the count already says where you are.
 */
function renderStepper(group, currentId) {
  const bar = $("stepper");
  bar.replaceChildren();
  bar.hidden = group.length < 2;
  if (bar.hidden) return;
  const index = group.findIndex((f) => f.properties.id === currentId);

  const go = (delta, dir) => {
    const next = group[(index + delta + group.length) % group.length];
    state.stepFocus = dir;
    // Re-select through the core so the map's own state moves with the card.
    map.select(next.properties.id);
    track("map_pin_open", {
      org_id: next.properties.org_id, site_id: next.properties.id, via: "stepper",
    });
  };

  bar.append(arrowButton("prev", "\u2039", "Previous site at this location", () => go(-1, "prev")));

  // Separate text nodes, never "1 of 2" as one string: the proxy translates the words and
  // leaves the numerals alone. See the language note at the top of this file.
  const count = el("p", span(String(index + 1)), " ", span("of"), " ",
                     span(String(group.length)), " ", span("at this location"));
  count.className = "step-count";
  bar.append(count);

  bar.append(arrowButton("next", "\u203a", "Next site at this location", () => go(1, "next")));
}

/** One stepper arrow. The glyph is decoration; the label is what is announced. */
function arrowButton(dir, glyph, label, onClick) {
  const mark = span(glyph);
  mark.setAttribute("aria-hidden", "true");
  const button = el("button", mark, hidden(label));
  button.type = "button";
  button.className = `step step-${dir}`;
  button.addEventListener("click", onClick);
  return button;
}

// ------------------------------------------------------------------------ the modal

/**
 * The card's modal and its link. Opening a card from the map or the list adds a history
 * entry with ?site=<id>, so the card has an address that can be shared, and the browser's
 * Back button — the one a phone user reaches for — closes the card instead of leaving the
 * page. Every way of closing it (the × button, Escape, a click on the blurred map) goes
 * back through that same entry, so the history never collects a trail of closed cards.
 *
 * Moving between cards while one is open (the stepper, or a pin on the small map)
 * replaces the entry instead of adding one: Back closes the card, whichever site it has
 * reached, rather than stepping back through each one.
 *
 * Inside an iframe the address that changes is the frame's, not the host page's, so the
 * link is embed.html?site=<id>. Back still works, because the browser keeps one history
 * for the page and its frames.
 */
function setupDialog() {
  const dialog = $("site-dialog");
  $("card-close").addEventListener("click", closeCard);
  // Escape arrives as `cancel`. Taken over so it closes through history like the rest.
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    closeCard();
  });
  // The dialog's children fill it, so a click that lands on the dialog element itself is
  // a click on the backdrop around it.
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) closeCard();
  });
  window.addEventListener("popstate", () => {
    const id = new URLSearchParams(window.location.search).get("site");
    if (id && state.byId.has(id)) {
      state.urlDriven = true;
      map.select(id);
      state.pushed = Boolean(history.state && history.state.mapkitSite);
    } else if (dialog.open) {
      hideCard();
    }
  });
}

function siteUrl(id) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("site", id);
  else url.searchParams.delete("site");
  return url;
}

/** Put the selected site in the address bar: a new entry when a card opens, else in place. */
function recordInUrl(id) {
  if (state.urlDriven) {
    state.urlDriven = false;
    return;
  }
  if ($("site-dialog").open) {
    history.replaceState(history.state, "", siteUrl(id));
  } else {
    history.pushState({ mapkitSite: id }, "", siteUrl(id));
    state.pushed = true;
  }
}

function openDialog(feature) {
  const dialog = $("site-dialog");
  if (!dialog.open) dialog.showModal();
  showOnMiniMap(feature);
}

/**
 * The small map at the top of the card: where this place is, at street level, with the
 * sites around it. It is the same map-core as the main map, so its pins look and behave
 * the same — tapping another pin here opens that site's card in place. Scroll-to-zoom is
 * off because the wheel belongs to the card's text; the zoom buttons and dragging stay.
 */
function showOnMiniMap(feature) {
  const id = feature.properties.id;
  if (!miniMap) {
    miniMap = createMap($("mini-map"), {
      style: structuredClone(mapInputs.style),
      data: mapInputs.data,
      onSelect: (picked, info) => {
        if (info.via === "map" && picked && picked.properties.id !== state.selectedId) {
          map.select(picked.properties.id);
          track("map_pin_open", {
            org_id: picked.properties.org_id, site_id: picked.properties.id, via: "mini_map",
          });
        }
      },
    });
    miniMap.raw.scrollZoom.disable();
    // MapLibre opens the compact attribution expanded until the first drag; on a map this
    // small it would cover the bottom third. Collapsed, it is the (i) button.
    miniMap.ready(() => miniMap.raw.getContainer()
      .querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show"));
  }
  // The dialog was display:none until a moment ago; the canvas has to measure again.
  miniMap.raw.resize();
  miniMap.ready(() => {
    miniMap.raw.jumpTo({ center: feature.geometry.coordinates, zoom: MINI_MAP_ZOOM });
    miniMap.select(id);
  });
}
// Street level, a little closer than the main map's: the card's map answers "where is
// this" for one place, not "what is near me".
const MINI_MAP_ZOOM = 15.5;

/** Close the card. If it has its own history entry, close it by going back. */
function closeCard() {
  if (state.pushed) {
    history.back();          // popstate finds no ?site= and calls hideCard
    return;
  }
  hideCard();
  history.replaceState(history.state, "", siteUrl(null));
}

function hideCard() {
  state.pushed = false;
  const dialog = $("site-dialog");
  if (dialog.open) dialog.close();
  const card = $("card");
  card.hidden = true;
  card.replaceChildren();
  const bar = $("stepper");
  bar.hidden = true;
  bar.replaceChildren();
  state.selectedId = null;
  markCurrent(null);
  if (map) map.select(null);
  const back = state.returnFocusTo;
  state.returnFocusTo = null;
  if (back && document.contains(back)) back.focus();
}

// ------------------------------------------------------------------------ live region

/** Announce through the single live region the map core owns. */
function announce(nodes) {
  if (!map) return;
  map.announce(el("p", nodes));
}

// ----------------------------------------------------------------------- bottom sheet

const SHEET_HEIGHTS = { collapsed: "48px", half: "45dvh", full: "85dvh" };
let sheetStep = "collapsed";

function setSheet(step) {
  sheetStep = step;
  document.documentElement.style.setProperty("--sheet-h", SHEET_HEIGHTS[step]);
  const handle = $("sheet-handle");
  handle.setAttribute("aria-expanded", step === "collapsed" ? "false" : "true");
  handle.querySelector(".chev").textContent = step === "full" ? "▼" : "▲";
}

function setupSheet() {
  setSheet("collapsed");
  const handle = $("sheet-handle");
  const panel = $("panel");

  handle.addEventListener("click", () => {
    setSheet(sheetStep === "collapsed" ? "half" : sheetStep === "half" ? "full" : "collapsed");
  });

  // Drag, in addition to tap. Pointer events cover mouse, touch and pen with one path.
  let start = null;
  handle.addEventListener("pointerdown", (e) => {
    start = { y: e.clientY, h: panel.getBoundingClientRect().height };
    handle.setPointerCapture(e.pointerId);
    panel.classList.add("dragging");
  });
  handle.addEventListener("pointermove", (e) => {
    if (!start) return;
    const h = Math.min(window.innerHeight * 0.9,
                       Math.max(48, start.h + (start.y - e.clientY)));
    panel.style.height = `${h}px`;
  });
  handle.addEventListener("pointerup", (e) => {
    if (!start) return;
    const moved = Math.abs(e.clientY - start.y);
    const h = panel.getBoundingClientRect().height;
    panel.classList.remove("dragging");
    panel.style.height = "";
    start = null;
    if (moved < 8) return;                       // a tap; the click handler owns it
    const frac = h / window.innerHeight;
    setSheet(frac < 0.2 ? "collapsed" : frac < 0.65 ? "half" : "full");
  });
}
