import { useLayoutEffect, useRef } from "react";
import type { Found } from "../../logic/places.ts";
import { Search } from "../../ui/Search.tsx";

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
    <section className="hero" ref={heroRef} aria-labelledby="landing-title">
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
  );
}
