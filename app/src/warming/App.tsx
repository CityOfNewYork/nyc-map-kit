import { useEffect, useRef, useState } from "react";
import type { MapCore } from "../core/map-core.ts";
import { nearestIds, prepareData } from "../logic/data.ts";
import type { Found } from "../logic/places.ts";
import type { Model, SiteCollection, SiteProperties } from "../logic/types.ts";
import { WarmingMap } from "./components/WarmingMap.tsx";
import { viewFromUrl } from "./logic/view.ts";
import type { View } from "./logic/view.ts";
import { LandingPage } from "./pages/LandingPage.tsx";
import { MapPage } from "./pages/MapPage.tsx";

// The warming centers listed in 311 article KA-03702, retrieved 2026-10-15. The file
// names its source and retrieval date.
const DATA_URL = "warming/centers.geojson";

/** How long the hero takes to fold away: .hero's transition in warming.css. */
const HERO_EXIT_MS = 300;

interface AppProps {
  lang: string;
}

export default function App({ lang }: AppProps) {
  const [view, setView] = useState<View>(() => viewFromUrl(window.location.search));
  const [model, setModel] = useState<Model | null>(null);
  const [failed, setFailed] = useState(false);
  const [found, setFound] = useState<Found | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);   // the hero is folding away
  const mapRef = useRef<MapCore<SiteProperties> | null>(null);
  const leaveTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(DATA_URL)
      .then((resp) => {
        if (!resp.ok) throw new Error(`${DATA_URL} returned ${resp.status}`);
        return resp.json() as Promise<SiteCollection>;
      })
      .then((data) => {
        if (!cancelled) setModel({ config: {}, data, ...prepareData({}, data, null) });
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

  // A search made before the map is ready is applied in onMapReady.
  useEffect(() => {
    if (mapRef.current) showFound(mapRef.current, found, model);
  }, [found, model]);

  function onMapReady(map: MapCore<SiteProperties>) {
    mapRef.current = map;
    showFound(map, found, model);
  }

  function openMap() {
    const url = new URL(window.location.href);
    url.searchParams.set("view", "map");
    history.pushState(null, "", url);
    setView("map");
  }

  /** From the landing view to the map view: the hero folds away, then the list arrives. */
  function leaveLanding() {
    if (view !== "landing" || leaveTimer.current !== null) return;
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
    openMap();
  }

  return (
    <>
      {/* Outside .site-main, which is positioned, so style.css can park it off-screen. */}
      {view === "map" && <a className="skip-link" href="#map">Skip the list and go to the map</a>}
      <header className="site-header">
        <h1>NYC Warming Centers</h1>
      </header>
      <main className="site-main">
        {failed ? (
          <p className="load-error"><span>The warming center data could not load.</span></p>
        ) : (
          // One map for both views: the hero or the list changes around it, and the map
          // stays as the reader left it. Touching the map on the landing view opens the
          // map view.
          <div className={view === "map" ? "stage" : "landing"}
               data-list={view === "map" ? "on" : undefined}>
            {view === "map" ? (
              <MapPage model={model} found={found} selectedId={selectedId}
                       onFound={setFound} onClear={() => setFound(null)}
                       onOpen={(feature) => mapRef.current?.select(feature.properties.id)} />
            ) : (
              <LandingPage leaving={leaving} onOpenMap={leaveLanding}
                           onFound={searchFromLanding} />
            )}
            <WarmingMap key="map" lang={lang} data={model && model.data}
                        padForList={view === "map"} onReady={onMapReady}
                        onSelect={(feature) => setSelectedId(feature && feature.properties.id)}
                        onInteract={view === "landing" ? leaveLanding : undefined} />
          </div>
        )}
      </main>
    </>
  );
}

/** Mark the searched place and frame it with the sites nearest it, or clear the mark. */
function showFound(map: MapCore<SiteProperties>, found: Found | null, model: Model | null) {
  if (!found) {
    map.showPlace(null);
    return;
  }
  map.showPlace({ center: found.center, bbox: found.bbox },
                model ? nearestIds(model.features, found.center) : []);
}
