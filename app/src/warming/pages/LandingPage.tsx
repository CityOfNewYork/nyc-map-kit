import { useLayoutEffect, useRef } from "react";
import type { Found } from "../../logic/places.ts";
import { Search } from "../../ui/Search.tsx";
import { t } from "../../logic/i18n.ts";

interface LandingPageProps {
  /** The hero is folding away on the way to the map view. */
  leaving: boolean;
  onOpenMap: () => void;
  onFound: (place: Found) => void;
}

/** The landing view's own part: the hero. The map below it is App's, shared with the map
 *  view. */
export function LandingPage({ leaving, onOpenMap, onFound }: LandingPageProps) {
  const heroRef = useRef<HTMLElement>(null);

  // From its measured height to none, so the transition in warming.css has two lengths
  // to run between; reading offsetHeight again makes the browser take the first one.
  useLayoutEffect(() => {
    const hero = heroRef.current;
    if (!leaving || !hero) return;
    hero.style.height = `${hero.offsetHeight}px`;
    void hero.offsetHeight;
    hero.style.height = "0px";
  }, [leaving]);

  return (
    <section className={leaving ? "hero leaving" : "hero"} ref={heroRef}
             aria-labelledby="landing-title">
      <div className="hero-inner">
        <h1 id="landing-title" tabIndex={-1}>{t("Find a warming center near you")}</h1>
        <p>
          <span>
            {t("During periods of extreme cold, warming centers may be activated across all boroughs, using both fixed sites and warming vehicles.")}
          </span>{" "}
          <span>
            {t("New Yorkers who see individuals they believe to be experiencing homelessness and in need should request")}
          </span>{" "}
          <a href="https://portal.311.nyc.gov/" target="_blank" rel="noopener">
            <span>{t("homeless outreach assistance")}</span>
            <span className="visually-hidden">{" "}{t("(opens in a new tab)")}</span>
          </a>.
        </p>
        <div className="hero-actions">
          <Search onFound={onFound} onClear={() => {}} />
          <button type="button" className="hero-map-link" onClick={onOpenMap}>
            <span>{t("See full map")}</span> <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </section>
  );
}
