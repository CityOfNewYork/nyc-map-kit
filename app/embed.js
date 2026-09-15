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
import { loadBasemapStyle, resolveLang } from "./basemap-style.js";

const BASEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
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
  generated: "",
  expandedOrg: null,
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

  state.orgs = orgsDoc ? normalizeOrgs(orgsDoc) : groupByOrgProperty(state.features);
  state.orgs = restrictToLoadedSites(state.orgs, state.byId);
  for (const org of state.orgs) state.orgById.set(org.org_id, org);

  applyTitle();
  renderCounts();
  renderList();
  setupSheet();

  const style = await loadBasemapStyle(BASEMAP_STYLE, settings.lang);
  $("loading").remove();

  map = createMap($("map"), {
    style,
    data,
    onSelect: handleSelect,
    onClusterExpand: () => {},
  });

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
  setCount("header-orgs", state.orgs.length);
  setCount("header-sites", state.features.length);
  setCount("sheet-orgs", state.orgs.length);
  setCount("sheet-sites", state.features.length);
  $("header-counts").removeAttribute("data-pending");
  $("stage").dataset.list = settings.list;
}

// -------------------------------------------------------------------------------- list

function renderList() {
  if (settings.list === "off") return;
  const list = $("org-list");
  list.replaceChildren();

  for (const org of state.orgs) {
    const item = el("li");
    const multi = org.sites.length > 1;

    const button = el("button");
    button.type = "button";
    button.className = "org-button";
    button.dataset.orgId = org.org_id;

    const chev = span(multi ? "▸" : " ", "chev");
    chev.setAttribute("aria-hidden", "true");
    button.append(chev, span(org.name, "name"));

    if (multi) {
      // Two text nodes, never "60 sites" as one string: the proxy translates the word
      // and leaves the numeral alone. Single-site orgs carry no badge at all, which
      // avoids having to pluralize anything in code.
      const count = el("span", span(String(org.sites.length)), " ", span("sites"));
      count.className = "count";
      button.append(count);
      button.setAttribute("aria-expanded", "false");
      button.addEventListener("click", () => toggleOrg(org, button));
    } else {
      button.addEventListener("click", () => {
        state.returnFocusTo = button;
        map.select(org.sites[0].id);
        track("map_pin_open", { org_id: org.org_id, site_id: org.sites[0].id, via: "list" });
      });
    }

    item.append(button);
    list.append(item);
  }
}

function toggleOrg(org, button) {
  const item = button.parentElement;
  const open = button.getAttribute("aria-expanded") === "true";

  // One org open at a time: two 60-site orgs expanded at once is a scroll, not a list.
  for (const other of $("org-list").querySelectorAll('.org-button[aria-expanded="true"]')) {
    other.setAttribute("aria-expanded", "false");
    const sub = other.parentElement.querySelector(".site-list");
    if (sub) sub.remove();
  }

  if (open) {
    state.expandedOrg = null;
    map.highlight([]);
    return;
  }

  button.setAttribute("aria-expanded", "true");
  state.expandedOrg = org.org_id;

  const sub = el("ul");
  sub.className = "site-list";
  for (const site of org.sites) {
    const siteButton = el("button");
    siteButton.type = "button";
    siteButton.className = "site-button";
    siteButton.dataset.siteId = site.id;
    siteButton.append(span(site.address, "addr"));
    if (site.borough) siteButton.append(span(site.borough, "boro"));
    siteButton.addEventListener("click", () => {
      state.returnFocusTo = siteButton;
      map.select(site.id);
      track("map_pin_open", { org_id: org.org_id, site_id: site.id, via: "list" });
    });
    sub.append(el("li", siteButton));
  }
  item.append(sub);

  // This is the move that makes a 60-site organization legible: every one of its sites
  // lights up at once and the rest of the city recedes.
  const ids = org.sites.map((s) => s.id);
  map.highlight(ids);
  map.fitTo(ids);
  announce([span("Showing"), " ", span(String(ids.length)), " ",
            span("sites for"), " ", span(org.name)]);
  track("map_list_expand", { org_id: org.org_id, sites: ids.length });
}

/** Mark the list row that corresponds to the current selection, and clear the others. */
function markCurrent(siteId) {
  if (settings.list === "off") return;
  const orgId = siteId ? state.byId.get(siteId)?.properties.org_id : null;
  for (const b of $("org-list").querySelectorAll(".org-button")) {
    if (b.dataset.orgId === orgId) b.setAttribute("aria-current", "true");
    else b.removeAttribute("aria-current");
  }
  for (const b of $("org-list").querySelectorAll(".site-button")) {
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
  renderCard(feature, info.coincident);
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
  // they just asked for instead of being left behind in the list.
  $("card-title").focus();
}

function renderCard(feature, coincident) {
  const p = feature.properties;
  const org = state.orgById.get(p.org_id) || {};
  const card = $("card");
  card.replaceChildren();

  const title = el("h2", p.org);
  title.id = "card-title";
  title.tabIndex = -1;
  card.append(title);

  if (p.dba) card.append(dbaLine(p.dba));

  if (coincident && coincident.length > 1) card.append(chooser(coincident, p.id));

  const where = el("p");
  where.className = "where";
  where.append(span(p.address, "addr"));
  if (p.borough) where.append(span(p.borough, "boro"));
  card.append(where);

  const dl = el("dl");
  for (const field of state.config.card || []) {
    const value = (field.source === "org" ? org[field.key] : p[field.key]) || "";
    if (!value) continue;
    dl.append(el("dt", span(field.label)));
    dl.append(el("dd", renderValue(field, value)));
  }
  if (dl.children.length) card.append(dl);

  if (state.config.directions !== false) {
    const [lon, lat] = feature.geometry.coordinates;
    const link = el("a", span("Directions"),
                    hidden("opens in your maps app"));
    link.className = "directions";
    // A deep link, not an SDK: no key, no billing account, no third-party script on the
    // page. It hands the resident off to whichever maps app they already use.
    link.href = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
    link.target = "_blank";
    link.rel = "noopener";
    link.addEventListener("click", () => track("map_directions_click", {
      org_id: p.org_id, site_id: p.id,
    }));
    card.append(link);
  }

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
}

function dbaLine(text) {
  const p = el("p", span(text));
  p.className = "dba";
  return p;
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
    a.href = `tel:${value.replace(/[^\d+]/g, "")}`;
    return a;
  }
  return span(value);
}

/**
 * More than one site at the clicked coordinate. The map cannot separate them — they are
 * the same pixel at every zoom — so the card offers the choice in text.
 */
function chooser(features, currentId) {
  const box = el("div");
  box.className = "chooser";
  box.append(el("p", span(String(features.length)), " ", span("sites at this address")));
  const list = el("ul");
  for (const f of features) {
    const button = el("button", span(f.properties.org));
    button.type = "button";
    if (f.properties.id === currentId) {
      button.setAttribute("aria-current", "true");
      button.disabled = true;
    } else {
      button.addEventListener("click", () => {
        // Re-select through the core so the map's own state moves with the card.
        map.select(f.properties.id);
        track("map_pin_open", {
          org_id: f.properties.org_id, site_id: f.properties.id, via: "chooser",
        });
      });
    }
    list.append(el("li", button));
  }
  box.append(list);
  return box;
}

function closeCard() {
  const card = $("card");
  card.hidden = true;
  card.replaceChildren();
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
