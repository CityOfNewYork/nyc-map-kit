import { useEffect, useEffectEvent, useState } from "react";
import { loadBasemap } from "../../core/basemaps/index.ts";
import type { MapCore } from "../../core/map-core.ts";
import type { Site, SiteCollection, SiteProperties } from "../../logic/types.ts";
import { keepClearOfList } from "../../ui/layout.ts";
import { useMapCore } from "../../ui/useMapCore.ts";

// Needs no local tile file, unlike the Protomaps default; revisit before launch.
const BASEMAP = "openfreemap";

interface WarmingMapProps {
  lang: string;
  data: SiteCollection | null;
  padForList?: boolean;
  onReady?: (map: MapCore<SiteProperties>) => void;
  onSelect?: (feature: Site | null) => void;
}

export function WarmingMap({ lang, data, padForList = false, onReady, onSelect }: WarmingMapProps) {
  const { containerRef, create, destroy } = useMapCore<SiteProperties>();
  const [failed, setFailed] = useState(false);
  const ready = useEffectEvent((map: MapCore<SiteProperties>) => onReady?.(map));
  const select = useEffectEvent((feature: Site | null) => onSelect?.(feature));

  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    let unpad = () => {};
    loadBasemap(BASEMAP, lang)
      .then((style) => {
        if (cancelled) return;
        const map = create({ style, data, onSelect: (feature) => select(feature) });
        if (padForList) unpad = keepClearOfList(map);
        ready(map);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      unpad();
      destroy();
    };
  }, [lang, data, padForList, create, destroy]);

  return (
    <div className="map" id="map" tabIndex={-1} ref={containerRef}>
      {failed && <p className="load-error"><span>The map could not load.</span></p>}
    </div>
  );
}
