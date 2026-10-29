import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { StyleSpecification } from "maplibre-gl";
import type { BasemapId } from "../core/basemaps/names.ts";
import type { MapCore, SelectInfo } from "../core/map-core.ts";
import { track } from "../logic/analytics.ts";
import { nearestIds, prepareData } from "../logic/data.ts";
import type { Found } from "../logic/places.ts";
import type { Model, Site, SiteCollection, SiteProperties } from "../logic/types.ts";
import { SiteDialog } from "../ui/SiteDialog.tsx";
import { useSiteCard } from "../ui/useSiteCard.ts";
import { CenterCard } from "./components/CenterCard.tsx";
import { centerMarker, centerRow } from "./components/CenterRow.tsx";
import { TopBar } from "./components/TopBar.tsx";
import { useNycMinute } from "./components/useNycMinute.ts";
import { WarmingMap } from "./components/WarmingMap.tsx";
import { CENTER_CONFIG, CENTER_MARK } from "./logic/centers.ts";
import { DATASETS, datasetFromUrl } from "./logic/dataset.ts";
import { filterChanges, filtersFromUrl, passes, withFilters } from "./logic/filters.ts";
import type { Filters } from "./logic/filters.ts";
import { viewFromUrl } from "./logic/view.ts";
import type { View } from "./logic/view.ts";
import { LandingPage } from "./pages/LandingPage.tsx";
import { MapPage } from "./pages/MapPage.tsx";
import { plural, t } from "../logic/i18n.ts";
import { useLanguage } from "../ui/useLanguage.ts";

/** How long the hero takes to fold away: .hero's transition in warming.css. */
const HERO_EXIT_MS = 300;

interface AppProps {
  /** The basemap's label language. */
  lang: string;
  basemap: BasemapId;
}

export default function App({ lang, basemap }: AppProps) {
  useLanguage();   // re-render in a new language (logic/i18n.ts)
  const [view, setView] = useState<View>(() => viewFromUrl(window.location.search));
  const [model, setModel] = useState<Model | null>(null);
  const [failed, setFailed] = useState(false);
  const [found, setFound] = useState<Found | null>(null);
  const [leaving, setLeaving] = useState(false);   // the hero is folding away
  const [style, setStyle] = useState<StyleSpecification | null>(null);   // the basemap
  const mapRef = useRef<MapCore<SiteProperties> | null>(null);
  const leaveTimer = useRef<number | null>(null);
  const focusMapHeading = useRef(false);   // move focus to the map view once it renders
  const [filters, setFilters] = useState<Filters>(() => filtersFromUrl(window.location.search));
  const minute = useNycMinute();
  // The centers the filters leave: the list and the map show these, and only these. The
  // clock only matters to Open now, so without it the list is not worked out each half hour.
  const clock = filters.openNow ? minute : 0;
  const shown = useMemo(
    () => (model ? model.features.filter((f) => passes(f, filters, clock)) : []),
    [model, filters, clock]);
  // A center's card: what is selected, its modal, its ?site= address, focus, its small map.
  const card = useSiteCard({ model, style, pin: CENTER_MARK, shown });
  const { attach, selectingFromUrl, dialogElement, miniMapElement } = card;

  // The sample centers ?dataset= names (logic/dataset.ts), read once: changing them
  // means loading the page again.
  useEffect(() => {
    let cancelled = false;
    const url = DATASETS[datasetFromUrl(window.location.search)];
    fetch(url)
      .then((resp) => {
        if (!resp.ok) throw new Error(`${url} returned ${resp.status}`);
        return resp.json() as Promise<SiteCollection>;
      })
      .then((data) => {
        if (!cancelled) {
          setModel({ config: CENTER_CONFIG, data, ...prepareData(CENTER_CONFIG, data, null) });
        }
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setFailed(true);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onPopState = () => setView(viewFromUrl(window.location.search));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => () => {
    if (leaveTimer.current !== null) clearTimeout(leaveTimer.current);
  }, []);

  // A search made before the map is ready is applied in onMapReady. A change of filters
  // does not frame the map again; a new search does.
  const frameFound = useEffectEvent(() => {
    if (mapRef.current) showFound(mapRef.current, found, shown);
  });
  useEffect(() => frameFound(), [found]);

  // Focus follows the reader into the map view when they asked for it: the "See full
  // map" button or a search. Touching the map changes nothing about focus.
  useEffect(() => {
    if (view !== "map" || !focusMapHeading.current) return;
    focusMapHeading.current = false;
    document.getElementById("map-heading")?.focus();
  }, [view]);

  function onMapReady(map: MapCore<SiteProperties>, basemap: StyleSpecification) {
    mapRef.current = map;
    attach(map);
    setStyle(basemap);
    showFound(map, found, shown);
    // A link with ?site= opens on that center's card.
    const id = new URLSearchParams(window.location.search).get("site");
    if (id && model?.byId.has(id)) {
      selectingFromUrl();
      map.select(id);
    }
  }

  /** A pin was chosen, or the selection cleared. On the landing view a touch on the map
   *  opens the map view (see onInteract) and nothing more, so a pin is let go again. */
  function onMapSelect(feature: Site | null, info: SelectInfo) {
    if (feature && view !== "map") {
      queueMicrotask(() => mapRef.current?.select(null));
      return;
    }
    card.onSelect(feature, info);
  }

  /** New filters: shown at once, and written into the address so Copy link carries them. */
  function changeFilters(next: Filters) {
    setFilters(next);
    history.replaceState(history.state, "", withFilters(new URL(window.location.href), next));
    for (const fields of filterChanges(filters, next)) track("filter_select", fields);
  }

  function openMap() {
    const url = new URL(window.location.href);
    url.searchParams.set("view", "map");
    history.pushState(null, "", url);
    setView("map");
  }

  /** From the landing view to the map view: the hero folds away, then the list arrives.
   *  `moveFocus` takes keyboard focus along to the map view. */
  function leaveLanding(moveFocus = false) {
    if (view !== "landing" || leaveTimer.current !== null) return;
    focusMapHeading.current = moveFocus;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      openMap();
      return;
    }
    setLeaving(true);
    leaveTimer.current = window.setTimeout(() => {
      leaveTimer.current = null;
      setLeaving(false);
      openMap();
    }, HERO_EXIT_MS);
  }

  function searchFromLanding(place: Found) {
    setFound(place);
    focusMapHeading.current = true;
    openMap();
  }

  return (
    <>
      <TopBar />
      <main className="site-main">
        {failed ? (
          <p className="load-error"><span>{t("The warming center data could not load.")}</span></p>
        ) : (
          // One map for both views: the hero or the list changes around it, and the map
          // stays as the reader left it. Touching the map on the landing view opens the
          // map view.
          <div className={view === "map" ? "stage" : "landing"}
               data-list={view === "map" ? "on" : undefined}>
            {view === "map" ? (
              <MapPage model={model} shown={shown} filters={filters} onFilters={changeFilters}
                       found={found}
                       selectedId={card.feature && card.feature.properties.id}
                       onFound={setFound} onClear={() => setFound(null)}
                       onOpen={card.openFromList} />
            ) : (
              <LandingPage leaving={leaving} onOpenMap={() => leaveLanding(true)}
                           onFound={searchFromLanding} />
            )}
            <SiteDialog ref={dialogElement} miniMapElement={miniMapElement}
                        feature={card.feature} group={card.group} model={model}
                        choices={card.choices} onChoose={card.choose}
                        choosing={{
                          heading: (n) => <span>{plural(n, "{n} location", "{n} locations")}</span>,
                          intro: <span>{t("These warming centers are in the same place.")}</span>,
                          row: (f) => centerRow(f, minute), marker: centerMarker,
                        }}
                        onStep={card.step} onClose={card.close}
                        card={(feature) => (
                          <CenterCard feature={feature} model={model!}
                                      origin={found && found.center} />
                        )} />
            <WarmingMap key="map" lang={lang} basemap={basemap} data={model && model.data}
                        shown={shown} onReady={onMapReady}
                        onSelect={onMapSelect}
                        onInteract={view === "landing" ? () => leaveLanding() : undefined} />
          </div>
        )}
      </main>
    </>
  );
}

/** Mark the searched place and frame it with the sites nearest it, or clear the mark. */
function showFound(map: MapCore<SiteProperties>, found: Found | null, features: Site[]) {
  if (!found) {
    map.showPlace(null);
    return;
  }
  map.showPlace({ center: found.center, bbox: found.bbox }, nearestIds(features, found.center));
}
