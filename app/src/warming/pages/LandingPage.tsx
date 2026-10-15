import type { Found } from "../../logic/places.ts";
import type { Model } from "../../logic/types.ts";
import { Search } from "../../ui/Search.tsx";
import { WarmingMap } from "../components/WarmingMap.tsx";

interface LandingPageProps {
  lang: string;
  model: Model | null;
  onOpenMap: () => void;
  onFound: (place: Found) => void;
}

export function LandingPage({ lang, model, onOpenMap, onFound }: LandingPageProps) {
  return (
    <div className="landing">
      <section className="hero" aria-labelledby="landing-title">
        <div className="hero-inner">
          <h2 id="landing-title">Find a warming center near you</h2>
          <p>
            During periods of extreme cold, warming centers may be activated across all
            boroughs, using both fixed sites and warming vehicles. New Yorkers who see
            individuals they believe to be experiencing homelessness and in need should
            request{" "}
            <a href="https://portal.311.nyc.gov/" target="_blank" rel="noopener">
              homeless outreach assistance
              <span className="visually-hidden"> (opens in a new tab)</span>
            </a>.
          </p>
          <div className="hero-actions">
            <Search onFound={onFound} onClear={() => {}} />
            <button type="button" className="hero-map-link" onClick={onOpenMap}>
              <span>See full map</span> <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      </section>
      <WarmingMap lang={lang} data={model && model.data} />
    </div>
  );
}
