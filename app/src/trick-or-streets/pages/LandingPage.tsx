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

/** DOT's page for the events, with every detail and the list of them. */
const DOT_PAGE = "https://www.nyc.gov/html/dot/html/pedestrians/trickorstreets.shtml";

/** The landing view's own part: the hero, with a spider's web in its corner and a spider
 *  hanging from it, drawn in halloween.css. The map below it is App's, shared with the
 *  map view. */
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
    // Not a landmark of its own: its <h1> names it, and it sits in <main>.
    <section className={leaving ? "hero leaving" : "hero"} ref={heroRef}>
      <div className="hero-inner">
        <h1 tabIndex={-1}>{t("Find Trick-or-Streets events near you")}</h1>
        <p>
          <span>
            {t("All through October, NYC DOT turns Open Streets, plazas and other streets into places for people, with Halloween and harvest activities.")}
          </span>{" "}
          <a href={DOT_PAGE} target="_blank" rel="noopener">
            <span>{t("For official event details, see NYC DOT's page.")}</span>
            <span className="visually-hidden">{" "}{t("(opens in a new tab)")}</span>
          </a>
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
