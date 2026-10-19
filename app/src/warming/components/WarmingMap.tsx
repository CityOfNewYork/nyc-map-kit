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
  /** Keep the camera's centre clear of the list. It can change while the map is showing. */
  padForList?: boolean;
  onReady?: (map: MapCore<SiteProperties>) => void;
  onSelect?: (feature: Site | null) => void;
  /** The reader clicked, dragged, zoomed or panned the map. Moves the map makes on its
   *  own, such as framing a search result, do not count. */
  onInteract?: () => void;
}

export function WarmingMap({
  lang, data, padForList = false, onReady, onSelect, onInteract,
}: WarmingMapProps) {
  const { containerRef, create, destroy } = useMapCore<SiteProperties>();
  const [map, setMap] = useState<MapCore<SiteProperties> | null>(null);
  const [failed, setFailed] = useState(false);
  const ready = useEffectEvent((created: MapCore<SiteProperties>) => onReady?.(created));
  const select = useEffectEvent((feature: Site | null) => onSelect?.(feature));
  const interact = useEffectEvent(() => onInteract?.());

  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    loadBasemap(BASEMAP, lang)
      .then((style) => {
        if (cancelled) return;
        const created = create({ style, data, onSelect: (feature) => select(feature) });
        // Only the reader's own input carries an originalEvent. A wheel zoom's movestart
        // carries none, so the wheel is heard on its own.
        created.raw.on("click", () => interact());
        created.raw.on("wheel", () => interact());
        created.raw.on("movestart", (e) => { if (e.originalEvent) interact(); });
        setMap(created);
        ready(created);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      setMap(null);
      destroy();
    };
  }, [lang, data, create, destroy]);

  // Its own effect, so the list arriving or leaving changes the padding, not the map.
  useEffect(() => {
    if (!map || !padForList) return;
    return keepClearOfList(map);
  }, [map, padForList]);

  return (
    <div className="map" id="map" tabIndex={-1} ref={containerRef}>
      {failed && <p className="load-error"><span>The map could not load.</span></p>}
    </div>
  );
}
