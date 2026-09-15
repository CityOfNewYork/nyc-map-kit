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

import { createMap } from "./map-core.js";
import { addLandcoverParks, loadBasemapStyle, resolveLang, warmTint } from "./basemap-style.js";

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

/**
 * How close two records have to be to count as one location, in metres.
 *
 * There is no answer to this in the data: the pair distances in the ABAWD file run
 * continuously from 0 to 160 m with no gap anywhere — the largest jump between two
 * consecutive pair distances in that range is 8 m. So the number comes from what the
 * stepper's label promises, "at this location", and 25 m is the widest radius where that
 * stays true. It catches the same building or the one next door: 415 and 417 E 151st
 * Street (7.9 m), 265 and 269 Henry Street (15.6 m, two doors of one campus), 701 and 705
 * Crotona Park North (17.2 m), plus the two pairs that geocode to a single point. At 50 m
 * it starts joining addresses on different streets, and the label stops being honest.
 *
 * Note that this is NOT "what the user cannot separate by zooming" — that would be 0 m,
 * since at z18 even a 15 m gap is about 35 px. It is a claim about the places, not about
 * the pixels, which is why it is a fixed ground distance and not a function of zoom.
 */
const CO_LOCATION_RADIUS_M = 25;
const DEFAULTS = { data: "sites.geojson", orgs: "orgs.json", list: "on" };

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

/** Push an analytics event. The host page's tag reads window.dataLayer. */
function track(event, payload) {
  window.dataLayer = window.dataLayer || [];
  const row = Object.assign({ event }, payload);
  window.dataLayer.push(row);
  console.log("[dataLayer]", row);
}

/**
 * Resolve a `data=` / `orgs=` parameter to a URL we are willing to fetch.
 *
 * These parameters are attacker-controllable — anyone can iframe this page with any
 * query string — so they are restricted to the block's own origin. Without this, the
 * embed is a content proxy: a third party could point it at their own GeoJSON and have
 * a city page render their text. Same-origin keeps "swap the data file" working (the
 * point of the parameter) without opening that door.
 */
function sameOriginUrl(value, fallback) {
  const url = new URL(value || fallback, document.baseURI);
  if (url.origin !== window.location.origin) {
    console.warn(`[embed] ignoring cross-origin data URL ${url.href}; using ${fallback}`);
    return new URL(fallback, document.baseURI);
  }
  return url;
}

// ------------------------------------------------------------------------- parameters

const params = new URLSearchParams(window.location.search);
const settings = {
  data: sameOriginUrl(params.get("data"), DEFAULTS.data),
  orgs: sameOriginUrl(params.get("orgs"), DEFAULTS.orgs),
  lang: resolveLang(params.get("lang")),
  list: params.get("list") === "off" ? "off" : DEFAULTS.list,
  title: params.get("title"),
};

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
};

let map = null;

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
  state.features = data.features;
  state.generated = data.generated || (orgsDoc && orgsDoc.generated) || "";
  for (const f of state.features) state.byId.set(f.properties.id, f);
  state.atCoord = indexByLocation(state.features);

  state.orgs = orgsDoc ? normalizeOrgs(orgsDoc) : groupByOrgProperty(state.features);
  state.orgs = restrictToLoadedSites(state.orgs, state.byId);
  for (const org of state.orgs) state.orgById.set(org.org_id, org);

  applyTitle();
  renderCounts();
  renderList();
  setupSheet();

  const style = warmTint(
    addLandcoverParks(await loadBasemapStyle(BASEMAP_STYLE, settings.lang)),
    BASEMAP_PALETTE);
  $("loading").remove();

  map = createMap($("map"), {
    style,
    data,
    onSelect: handleSelect,
    onClusterExpand: () => {},
    // No focusPoint: a selected pin lands at the centre of the map itself, not of the
    // whole block. The list beside the map is a separate panel, so centring on the block
    // pushed every selection into the left half of the map the reader is looking at. The
    // card then opens beside the pin (placeDock); the pin, not the pair, is centred.
  });

  // The card follows its pin across pans and zooms, like a popup would.
  map.raw.on("move", placeDock);
  window.addEventListener("resize", placeDock);

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

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("card").hidden) closeCard();
  });
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

// ----------------------------------------------------------------------- data shaping

function normalizeOrgs(doc) {
  const list = Array.isArray(doc) ? doc : (doc.orgs || []);
  return list.map((o) => Object.assign({}, o, { sites: o.sites || [] }));
}

/**
 * orgs.json describes the whole dataset, but `data=` can point at a subset — the one-site
 * demo iframe is exactly that case. Keep only the organizations and sites that are
 * actually on this map, so the counts and the list describe what the reader can see.
 */
function restrictToLoadedSites(orgs, byId) {
  const out = [];
  for (const org of orgs) {
    const sites = org.sites.filter((s) => byId.has(s.id));
    if (sites.length) out.push(Object.assign({}, org, { sites }));
  }
  return out;
}

/**
 * Fallback when there is no orgs.json: build the org list from the features themselves.
 * The card then shows only what the features carry — the long org prose lives in
 * orgs.json, so it is simply absent. Documented in the README §Embed contract.
 */
function groupByOrgProperty(features) {
  const out = new Map();
  for (const f of features) {
    const p = f.properties;
    const key = p.org_id || p.org;
    let org = out.get(key);
    if (!org) {
      org = { org_id: key, name: p.org, dba: p.dba, website: p.website, phone: p.phone,
              org_type: p.org_type, sites: [] };
      out.set(key, org);
    }
    org.sites.push({
      id: p.id, address: p.address, borough: p.borough,
      lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
    });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Metres between two [lon, lat] pairs. Flat-earth, which is exact enough at 25 m. */
function metresBetween(a, b) {
  const x = (b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180) * 111320;
  const y = (b[1] - a[1]) * 110540;
  return Math.hypot(x, y);
}

/**
 * Group the features into locations: sets of records within CO_LOCATION_RADIUS_M of one
 * another. Computed once, from the data, because co-location is a fact about the places —
 * the map only knows about pixels, and a pixel at city zoom is 116 m.
 *
 * A record joins a group only if it is within the radius of EVERY member already in it,
 * not just the nearest one. Single-link grouping would chain — A near B, B near C, and a
 * group containing two records 50 m apart, which is exactly what the label must not
 * claim. Data order decides the seed, so the grouping is deterministic.
 *
 * Five groups in the ABAWD data, covering ten sites, none deeper than two. Two of them
 * geocode to a single point and the rest are a building apart. See the radius note above.
 */
function indexByLocation(features) {
  const groups = [];
  for (const f of features) {
    const here = f.geometry.coordinates;
    const group = groups.find((g) => g.every(
      (other) => metresBetween(here, other.geometry.coordinates) <= CO_LOCATION_RADIUS_M));
    if (group) group.push(f);
    else groups.push([f]);
  }
  const at = new Map();
  for (const group of groups) {
    for (const f of group) at.set(f.properties.id, group);
  }
  return at;
}

/** Every record at this feature's location, in data order, including itself. */
function coincidentWith(feature) {
  return state.atCoord.get(feature.properties.id) || [feature];
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
 * Sorted north to south, so the list runs down the city the way the map does: scroll the
 * list and you travel from the Bronx to the South Shore. An alphabetical order put the
 * rows in an order the map cannot show, which made the two halves of the block feel like
 * two datasets; geography is the one ordering both can agree on. Ties fall back to
 * organization and address so the order never depends on how the source file was written.
 */
function renderList() {
  if (settings.list === "off") return;
  const list = $("site-list");
  list.replaceChildren();

  const sites = state.features.slice().sort((a, b) =>
    b.geometry.coordinates[1] - a.geometry.coordinates[1] ||
    a.properties.org.localeCompare(b.properties.org) ||
    a.properties.address.localeCompare(b.properties.address));

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
  // On a phone the sheet and the card compete for the same screen. Choosing a site means
  // "show me this place", so the sheet gets out of the way — and comes back at the height
  // it was when the card closes, so the user does not lose their place in the list.
  collapseSheetForCard();
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
  renderStepper(coincidentWith(feature), p.id);

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
  for (const field of state.config.card || []) {
    const value = (field.source === "org" ? org[field.key] : p[field.key]) || "";
    if (!value) continue;
    // The source's "DBA or Program Name" column is a mix of trading names, acronyms and
    // programme names, so it is shown as a labelled field rather than as a subtitle. 22
    // of the 185 records repeat the organization name in it; that is not a second name.
    if (field.key === "dba" && value.trim() === p.org.trim()) continue;
    dl.append(el("dt", span(field.label)));
    dl.append(el("dd", renderValue(field, value)));
  }
  if (dl.children.length) card.append(dl);

  if (state.generated) {
    const footer = el("p", span("Data updated"), " ", stamp(state.generated));
    footer.className = "card-footer";
    card.append(footer);
  }

  // Last in the DOM, pinned to the top-right corner by CSS. Last so that Tab from the
  // heading walks the card's content and arrives at Close, instead of leaving Close
  // reachable only with Shift+Tab. (Escape closes the card as well.)
  const glyph = span("×");
  glyph.setAttribute("aria-hidden", "true");
  const close = el("button", glyph, hidden("Close this site"));
  close.type = "button";
  close.className = "card-close";
  close.addEventListener("click", closeCard);
  card.append(close);

  card.hidden = false;
  placeDock();
}

/**
 * Put the card beside its pin. On desktop the dock sits to the right of the selected
 * pin, vertically centred on the pin's head, and flips to the left only when the right
 * side has no room — after the user has panned, since a selection eases the pin to a
 * spot with room already. Clamped inside the stage either way, so the card is never cut
 * off. On a phone the card is full-width at the top of the map and CSS places it.
 */
// The selected pin is drawn at 1.25× a 26 × 34 px teardrop: ~32 px wide, ~42 px tall,
// with the head's centre ~26 px above the tip. The gap is two pin widths, so the card
// reads as beside the place rather than attached to it.
const CARD_GAP = 64;    // px between the pin and the card
const PIN_HEAD = 26;    // px from the pin's tip (the coordinate) up to the centre of its head
const DOCK_INSET = 12;  // px the dock keeps from the edge of the stage
function placeDock() {
  const dock = $("card-dock");
  if (phone()) {
    dock.style.left = dock.style.top = dock.style.right = "";
    return;
  }
  const feature = state.byId.get(state.selectedId);
  if (!map || $("card").hidden || !feature) return;
  const stage = $("stage").getBoundingClientRect();
  const box = $("map").getBoundingClientRect();
  const pin = map.raw.project(feature.geometry.coordinates);
  const x = pin.x + box.left - stage.left;
  const y = pin.y + box.top - stage.top - PIN_HEAD;
  const w = dock.offsetWidth;
  const h = dock.offsetHeight;
  let left = x + CARD_GAP;
  if (left + w > stage.width - DOCK_INSET) left = x - CARD_GAP - w;
  left = Math.max(DOCK_INSET, Math.min(left, stage.width - w - DOCK_INSET));
  const top = Math.max(DOCK_INSET, Math.min(y - h / 2, stage.height - h - DOCK_INSET));
  dock.style.left = `${left}px`;
  dock.style.top = `${top}px`;
  dock.style.right = "auto";
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
 * rather than read from a single field — see `mapsQuery`.
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

  for (const action of state.config.actions || []) {
    const value = (action.source === "org" ? org[action.key] : p[action.key]) || "";
    if (!value) continue;
    const link = el("a", span(action.label, "action-label"));
    link.className = "action";

    if (action.as === "tel") {
      link.href = telHref(value);
      link.append(span(value, "action-detail"));
    } else {
      const href = /^https?:\/\//i.test(value) ? value : `https://${value}`;
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener";
      link.append(span(String(value).replace(/^https?:\/\//i, "").replace(/\/$/, ""),
                       "action-detail"));
    }

    link.addEventListener("click", () => track("map_action_click", {
      org_id: p.org_id, site_id: p.id, action: action.key,
    }));
    box.append(link);
  }

  if (state.config.openInMaps !== false) {
    const query = mapsQuery(feature, org);
    const [lon, lat] = feature.geometry.coordinates;
    const link = el("a", span("Open in Google Maps", "action-label"),
                       span("see this location on a full map", "action-detail"));
    link.className = "action";
    // Google's documented Search URL. It used to be the Directions URL, which opens a
    // routing form already asking where you are coming from — a question the resident
    // has not been asked yet and may not want to answer. Showing them the place is the
    // smaller, more likely request; routing is one tap further on, inside the app that
    // is better at it than this block would be.
    //
    // A deep link either way, not an SDK: no key, no billing account, no third-party
    // script on the page.
    link.href = "https://www.google.com/maps/search/?api=1&query="
              + encodeURIComponent(query || `${lat},${lon}`);
    link.target = "_blank";
    link.rel = "noopener";
    link.addEventListener("click", () => track("map_open_in_maps_click", {
      org_id: p.org_id, site_id: p.id,
    }));
    box.append(link);
  }

  return box.children.length ? box : null;
}

/**
 * The text to hand Google for this site, or null to fall back to its coordinate.
 *
 * It is the ADDRESS, and deliberately nothing else. There are three things this link
 * could carry, and they are not on a single scale of better:
 *
 *   coordinate     an unlabelled pin. Google has nothing to look up, so there is no
 *                  title, no hours, no Street View, no photo — a dot the resident has
 *                  to take on trust, which the map they are already looking at does
 *                  better than Google does.
 *   address        Google's card for that address: the pin, Street View, a Directions
 *                  button, and the businesses it knows are at that address. This is
 *                  the jump from nothing to something.
 *   name + address the organization's own Google profile — hours, photos, reviews —
 *                  WHEN the name matches something Google has at that address.
 *
 * The third was tried and removed. The name in this data is typed into a spreadsheet by
 * 75 different organizations and is never checked against Google's index, so prepending
 * it does not look up a place, it biases a text search. When it misses the usual result
 * is harmless — Google falls back to the address and you get the second row anyway — but
 * when it misses by matching a DIFFERENT BRANCH of the same organization, the resident is
 * sent to the wrong building with no sign anything went wrong. That is not hypothetical
 * here: 20 of the addresses carry no ZIP, every one of them belongs to a multi-site
 * organization, and 13 are Henry Street Settlement, whose name is a strong Google listing
 * of its own. The extra hours-and-photos panel is not worth a silent wrong address.
 *
 * The remaining cost is that Google re-geocodes the text with its own engine, so its pin
 * can disagree with ours, which came from NYC GeoSearch — the city's own address database,
 * and the more authoritative of the two for a NYC house number. Addresses Google reads
 * differently are corrected by hand in data/overrides.json, which writes a `maps_query`
 * onto just those features; it is absent everywhere else and so costs the payload nothing
 * for the 180 sites that do not need it.
 *
 * Which fields compose the query is config, like the rest of the card: `openInMaps.query`
 * is a list of field references, joined with commas — a dataset that keeps street, city and
 * state in separate columns lists all three. Setting `openInMaps` to `true` instead of an
 * object keeps the coordinate, which is the right choice for a dataset whose addresses are
 * too rough to hand to a global geocoder.
 */
function mapsQuery(feature, org) {
  const parts = (state.config.openInMaps || {}).query;
  if (!Array.isArray(parts)) return null;              // `true` => use the coordinate
  const p = feature.properties;
  if (p.maps_query) return p.maps_query;               // hand fix from overrides.json

  const out = [];
  for (const part of parts) {
    const src = part.source === "org" ? (org || {}) : p;
    const value = String(src[part.key] || "").trim();
    if (value && !out.includes(value)) out.push(value);
  }
  return out.join(", ") || null;
}

function stamp(iso) {
  const time = el("time");
  time.dateTime = iso;
  const d = new Date(`${iso}T12:00:00`);
  time.textContent = Number.isNaN(d.valueOf())
    ? iso
    : d.toLocaleDateString(settings.lang, { year: "numeric", month: "long", day: "numeric" });
  return time;
}

/**
 * Turn one field's value into readable structure.
 *
 * The source strings carry their own shape and the card used to throw it away — a
 * semicolon-separated list and a five-line block of prose both arrived as one run-on
 * paragraph held together by `white-space: pre-line`. Both are hard to read for the same
 * reason: nothing tells the eye where one item ends and the next begins.
 *
 *   "a; b; c"                 -> a list, one item per line
 *   "intro:\nx\ny\nz"          -> a sentence, then a list
 *   "para one\npara two"       -> separate paragraphs
 *
 * No colour and no new type sizes involved — the readability comes from the line breaks
 * being real elements instead of characters inside one string.
 */
function structure(value) {
  const lines = String(value).split("\n").map((l) => l.trim()).filter(Boolean);

  if (lines.length > 1) {
    const out = [];
    // A line ending in a colon is introducing what follows, so the rest is a list.
    if (lines[0].endsWith(":") && lines.length > 2) {
      out.push(el("p", span(lines[0])));
      const ul = el("ul");
      for (const line of lines.slice(1)) ul.append(el("li", span(line)));
      out.push(ul);
      return out;
    }
    for (const line of lines) out.push(el("p", span(line)));
    return out;
  }

  const parts = lines[0].split(";").map((x) => x.trim()).filter(Boolean);
  if (parts.length > 1) {
    const ul = el("ul");
    for (const part of parts) ul.append(el("li", span(part)));
    return [ul];
  }

  return [span(lines[0] || "")];
}

/**
 * A dial string from a number written for a human to read.
 *
 * 21 of the 185 sites carry an extension — "(212)766-9200 x2224". Stripping every
 * non-digit turns that into 21276692002224, which is not a phone number, and a phone
 * handed it will try to dial it anyway. RFC 3966 keeps the extension in its own field:
 * tel:2127669200;ext=2224.
 */
function telHref(value) {
  const [main, ext] = String(value).split(/\s*(?:x|ext\.?|extension)\s*/i);
  const digits = String(main).replace(/[^\d+]/g, "");
  const extension = (ext || "").replace(/\D/g, "");
  return `tel:${digits}${extension ? `;ext=${extension}` : ""}`;
}

function renderValue(field, value) {
  if (field.as === "url") {
    const href = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    const a = el("a", span(value.replace(/^https?:\/\//i, "").replace(/\/$/, "")));
    a.href = href;
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

function closeCard() {
  const card = $("card");
  card.hidden = true;
  card.replaceChildren();
  const bar = $("stepper");
  bar.hidden = true;
  bar.replaceChildren();
  state.selectedId = null;
  markCurrent(null);
  if (map) map.select(null);
  restoreSheetAfterCard();
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
const phone = () => window.matchMedia("(max-width: 767px)").matches;
let sheetStep = "collapsed";
let sheetStepBeforeCard = null;

function setSheet(step) {
  sheetStep = step;
  document.documentElement.style.setProperty("--sheet-h", SHEET_HEIGHTS[step]);
  const handle = $("sheet-handle");
  handle.setAttribute("aria-expanded", step === "collapsed" ? "false" : "true");
  handle.querySelector(".chev").textContent = step === "full" ? "▼" : "▲";
}

function collapseSheetForCard() {
  if (!phone() || sheetStep === "collapsed") return;
  sheetStepBeforeCard = sheetStep;
  setSheet("collapsed");
}

function restoreSheetAfterCard() {
  if (!sheetStepBeforeCard) return;
  if (phone()) setSheet(sheetStepBeforeCard);
  sheetStepBeforeCard = null;
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
