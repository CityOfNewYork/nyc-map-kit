import { useEffect, useState } from "react";
import { prepareData } from "../logic/data.ts";
import type { Found } from "../logic/places.ts";
import type { Model, SiteCollection } from "../logic/types.ts";
import { viewFromUrl } from "./logic/view.ts";
import type { View } from "./logic/view.ts";
import { LandingPage } from "./pages/LandingPage.tsx";
import { MapPage } from "./pages/MapPage.tsx";

// Sample data from the design prototype until the real source is agreed.
const DATA_URL = "warming/centers.geojson";

interface AppProps {
  lang: string;
}

export default function App({ lang }: AppProps) {
  const [view, setView] = useState<View>(() => viewFromUrl(window.location.search));
  const [model, setModel] = useState<Model | null>(null);
  const [failed, setFailed] = useState(false);
  const [found, setFound] = useState<Found | null>(null);

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

  function openMap() {
    const url = new URL(window.location.href);
    url.searchParams.set("view", "map");
    history.pushState(null, "", url);
    setView("map");
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
        ) : view === "map" ? (
          <MapPage lang={lang} model={model} found={found}
                   onFound={setFound} onClear={() => setFound(null)} />
        ) : (
          <LandingPage lang={lang} model={model} onOpenMap={openMap} onFound={searchFromLanding} />
        )}
      </main>
    </>
  );
}
