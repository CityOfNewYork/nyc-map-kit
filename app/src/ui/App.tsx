/**
 * App.tsx — the block: the list, the map, and the card either of them opens.
 *
 * What is selected, and everything that follows from a selection — the address bar, the
 * modal, focus, and the small map in the card — is useSiteCard's. The components under
 * it are markup. The maps are only ever touched through map-core's API (core/map-core.ts), so
 * the map half of the block can be reused without any of this.
 *
 * TWO RULES THIS FILE AND ITS COMPONENTS KEEP:
 *
 * 1. LANGUAGE. Every visible string, screen-reader copy included, goes through `t` or
 *    `plural` (logic/i18n.ts), whole: a phrase with a number or a name in it is one
 *    template, "Show {n} locations", never words glued around a value, because each
 *    language orders them its own way. The interface's words are in src/i18n/; the data's
 *    own text, such as names, addresses and descriptions, is shown as it comes.
 *
 *    Each changing string sits alone in its own element. A translator working in the
 *    browser (Chrome's, say) swaps text nodes for elements of its own. When a string is
 *    the ONLY child of its element, React changes it by replacing the element's whole
 *    content, so a swapped node cannot be left behind showing the previous value. Text
 *    sitting next to other children — `<p>Hours: {hours}</p>` — is edited in place, and
 *    is what goes stale or crashes under a translator.
 *
 * 2. ACCESSIBILITY. The list is the text alternative to the map. Every site the map
 *    draws is reachable from it by keyboard, selection moves focus to the card, and
 *    closing the card puts focus back where it came from. A search re-orders the list;
 *    it never removes a site from it.
 */
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { StyleSpecification } from "maplibre-gl";
import { loadBasemap } from "../core/basemaps/index.ts";
import type { MapCore, SelectInfo } from "../core/map-core.ts";
import { stockCategories, stockStyles } from "../core/pins.ts";
import type { PinStyle } from "../core/pins.ts";
import { track } from "../logic/analytics.ts";
import { nearestIds, prepareData } from "../logic/data.ts";
import { ofTypes, orgTypes, typesFromUrl, valuesByCount, withTypes } from "../logic/filters.ts";
import type { Settings } from "../logic/params.ts";
import type { Found } from "../logic/places.ts";
import type {
  Config, Model, OrgsDoc, Site, SiteCollection, SiteProperties,
} from "../logic/types.ts";
import { CategoryIcon } from "./CategoryIcon.tsx";
import { FilterDisclosure, FiltersButton, FiltersPanel } from "./Filters.tsx";
import { keepClearOfList } from "./layout.ts";
import { Panel } from "./Panel.tsx";
import { Search } from "./Search.tsx";
import { SiteDialog } from "./SiteDialog.tsx";
import { useLanguage } from "./useLanguage.ts";
import { useMapCore } from "./useMapCore.ts";
import { useSiteCard } from "./useSiteCard.ts";
import { plural, t } from "../logic/i18n.ts";

/** The heading until config.json or `?title=` names the map: the page's own <title>. */
const DEFAULT_TITLE = document.title;

interface AppProps {
  settings: Settings;
}

export default function App({ settings }: AppProps) {
  useLanguage();   // re-render in a new language (logic/i18n.ts)
  const [model, setModel] = useState<Model | null>(null);   // config.json + the prepared data
  const [basemap, setBasemap] = useState<StyleSpecification | null>(null);   // once fetched
  const [failed, setFailed] = useState(false);
  const [found, setFound] = useState<Found | null>(null);   // what the search box found
  // The organization types to show; none means all. In the address, so a link carries it.
  const [types, setTypes] = useState(() => typesFromUrl(window.location.search));
  const [filtering, setFiltering] = useState(false);
  const filterButton = useRef<HTMLButtonElement>(null);

  // The sites the filter leaves: the list and the map show these, and only these.
  const shown = useMemo(() => (model ? ofTypes(model.features, types) : []), [model, types]);
  const listed = model && { ...model, features: shown };

  // Each pin category's colour and mark, when config.json asks for them (see core/pins.ts).
  const pinField = model?.config.pins?.field;
  const pinStyles = useMemo(
    () => (model && pinField
      ? stockStyles(valuesByCount(model.features, pinField).map(({ type }) => type))
      : null),
    [model, pinField]);
  const categories = useMemo(
    () => (pinField && pinStyles ? stockCategories(pinField, pinStyles) : null),
    [pinField, pinStyles]);

  const main = useMapCore<SiteProperties>();
  const { containerRef } = main;
  // The card: what is selected, its modal, its ?site= address, focus and its small map.
  const card = useSiteCard({ model, style: basemap, categories });
  const { attach, selectingFromUrl, dialogElement, miniMapElement } = card;

  // ------------------------------------------------------------------------- loading

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const loaded = await loadData(settings);
      if (cancelled) return;
      setModel(loaded);                // the list can render while the basemap loads
      // The basemap's labels stay English in every language, so the map is the same
      // whichever is chosen.
      const style = await loadBasemap(settings.basemap, "en");
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
  const onMapSelect = useEffectEvent(
    (feature: Site | null, info: SelectInfo) => card.onSelect(feature, info));

  useEffect(() => {
    if (!model || !basemap) return;
    let map: MapCore<SiteProperties>;
    try {
      map = main.create({
        style: structuredClone(basemap),
        data: model.data,
        categories,
        counts: true,
        describedBy: "map-keys",
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

    attach(map);

    // Set before the style loads, so the first framing already accounts for the list.
    const unpad = settings.list !== "off" ? keepClearOfList(map) : () => {};

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
      selectingFromUrl();
      map.select(settings.site);
    }

    return () => {
      unpad();
      attach(null);
      main.destroy();
    };
  }, [model, basemap, categories, settings, main, attach, selectingFromUrl]);

  // Its own effect, so a filter changes the pins without making the map again.
  useEffect(() => {
    const map = main.mapRef.current;
    if (map && basemap) map.setData({ type: "FeatureCollection", features: shown });
  }, [shown, basemap, main]);

  // A search result: mark it and frame it with the sites nearest it. A neighborhood or
  // ZIP code is marked at its centre too — that is the point the list's distances are
  // measured from, so the reader can see where "nearest" means. An effect rather
  // than the search's callback so that a search made before the map exists lands once
  // the map does.
  useEffect(() => {
    const map = main.mapRef.current;
    if (!map || !model) return;
    if (!found) {
      map.showPlace(null);
      return;
    }
    map.showPlace({ center: found.center, bbox: found.bbox }, nearestIds(shown, found.center));
  }, [found, model, shown, basemap, main]);

  /** New types: shown at once, and written into the address so a copied link carries them. */
  function changeTypes(next: string[]) {
    setTypes(next);
    history.replaceState(history.state, "", withTypes(new URL(window.location.href), next));
  }
  function toggleType(type: string, on: boolean) {
    changeTypes(on ? [...types, type] : types.filter((t) => t !== type));
    track("map_filter", { filter: "type", value: `${type}:${on}` });
  }
  function clearTypes() {
    changeTypes([]);
    track("map_filter", { filter: "clear" });
  }
  function closeFilters() {
    setFiltering(false);
    filterButton.current?.focus();
  }

  // ------------------------------------------------------------------------- render

  const feature = card.feature;
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

      <div className="stage" id="stage" data-list={model ? settings.list : "on"}>
        {/* The search box and the Filters button above the list, one column on a desktop.
            On a phone the list is a bottom sheet and this wrapper drops out of the layout
            (see style.css). */}
        <div className="side">
          <div className="search-row">
            <Search onFound={setFound} onClear={() => setFound(null)} />
            <FiltersButton ref={filterButton} controls="filters" open={filtering}
                           active={types.length ? 1 : 0}
                           onClick={() => (filtering ? closeFilters() : setFiltering(true))} />
          </div>
          {filtering && model && (
            <FiltersPanel id="filters" shown={shown.length} onClose={closeFilters}
                          onClear={clearTypes}>
              <FilterDisclosure label={t(model.config.filterLabel || "Organization type")}
                                chosen={types.length}>
                {orgTypes(model.features).map(({ type }) => (
                  <label key={type} className="filter-check">
                    <input type="checkbox" checked={types.includes(type)}
                           onChange={(e) => toggleType(type, e.target.checked)} />
                    {pinField === "org_type" && <TypeIcon style={pinStyles?.get(type)} />}
                    <span>{type}</span>
                  </label>
                ))}
              </FilterDisclosure>
            </FiltersPanel>
          )}
          <Panel model={listed} list={settings.list} origin={found && found.center}
                 selectedId={feature && feature.properties.id} onOpen={card.openFromList}
                 label={t(model?.config.listLabel || "Volunteer sites")}
                 summary={<SiteCounts sites={listed && shown} count={model?.config.count} />}
                 row={(f) => siteRow(f, pinField === "org_type" ? pinStyles : null)} />
        </div>
        {/* What the map's canvas reads out when it takes focus (map-core's describedBy),
            and shows while it has keyboard focus (style.css, .map-keys). */}
        <p className="map-keys visually-hidden" id="map-keys">
          {t("Arrow keys move the map. Plus and minus zoom in and out.")}
          {settings.list !== "off" && " " + t("Every site on the map is also in the list.")}
        </p>
        {/* map-core fills this div; React only puts the loading and error notes in it. */}
        <div className="map" id="map" ref={containerRef}>
          {failed ? (
            <p className="load-error" id="loading"><span>{t("The map could not load its data.")}</span></p>
          ) : !basemap && (
            <p className="loading" id="loading"><span>{t("Loading the map…")}</span></p>
          )}
        </div>
      </div>

      <SiteDialog ref={dialogElement} miniMapElement={miniMapElement}
                  feature={feature} group={card.group}
                  model={model} origin={found && found.center}
                  onStep={card.step} onClose={card.close} />
    </>
  );
}

// ---------------------------------------------------------------------------- loading

/**
 * A JSON file, or `fallback` if it is missing or unreadable. `T` is what the file should
 * hold; nothing checks that it does (see logic/types.ts).
 */
async function fetchJson<T>(url: string | URL, fallback: T): Promise<T> {
  try {
    const resp = await fetch(url);
    // A missing orgs.json is a supported configuration, not a failure: the block falls
    // back to grouping the features by their `org` property.
    if (!resp.ok) return fallback;
    return await resp.json();
  } catch (err) {
    console.warn(`[embed] could not load ${url}: ${(err as Error).message}`);
    return fallback;
  }
}

/** config.json, the point data and orgs.json, shaped by logic/data.ts. */
async function loadData(settings: Settings): Promise<Model> {
  const [config, data, orgsDoc] = await Promise.all([
    fetchJson<Config>(settings.config, {}),
    fetchJson<SiteCollection | null>(settings.data, null),
    settings.orgs ? fetchJson<OrgsDoc | null>(settings.orgs, null) : null,
  ]);
  if (!data || !Array.isArray(data.features)) {
    throw new Error(`no point data at ${settings.data.pathname}`);
  }
  const cfg = config || {};
  return { config: cfg, data, ...prepareData(cfg, data, orgsDoc) };
}

// ------------------------------------------------------------------------- the list

/**
 * "75 organizations · 185 sites", or as many as the filter leaves: the list's top line.
 * A map whose config.json gives a `count` says that instead: "486 centers". Each count in
 * the form its language gives that number (see logic/i18n.ts).
 */
function SiteCounts({ sites, count }: { sites: Site[] | null; count?: Config["count"] }) {
  const orgCount = sites ? new Set(sites.map((f) => f.properties.org_id)).size : undefined;
  const siteCount = sites ? sites.length : undefined;
  if (count) {
    return siteCount !== undefined && (
      <span id="sheet-sites">{plural(siteCount, count.one, count.other)}</span>
    );
  }
  return (
    orgCount !== undefined && siteCount !== undefined && (
      <>
        <span id="sheet-orgs">{plural(orgCount, "{n} organization", "{n} organizations")}</span>
        {" "}<span aria-hidden="true">·</span>{" "}
        <span id="sheet-sites">{plural(siteCount, "{n} site", "{n} sites")}</span>
      </>
    )
  );
}

/** A category's icon, or nothing for a value without a pin style. */
function TypeIcon({ style }: { style?: PinStyle }) {
  return style ? <CategoryIcon color={style.color} glyph={style.glyph} fill /> : null;
}

/** A row's lines: the organization's name, its type — with its pins' icon, when the pins
 *  are coloured by type — and the site's address. */
function siteRow(feature: Site, styles: Map<string, PinStyle> | null) {
  const p = feature.properties;
  return (
    <>
      <span className="name">{p.org}</span>
      {p.org_type && (
        <span className="type">
          {styles && <TypeIcon style={styles.get(p.org_type)} />}
          <span>{p.org_type}</span>
        </span>
      )}
      <span className="addr">{p.address}</span>
    </>
  );
}
