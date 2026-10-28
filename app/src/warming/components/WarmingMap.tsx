import { useEffect, useEffectEvent, useState } from "react";
import { loadBasemap } from "../../core/basemaps/index.ts";
import type { BasemapId } from "../../core/basemaps/names.ts";
import type { StyleSpecification } from "maplibre-gl";
import type { MapCore, SelectInfo } from "../../core/map-core.ts";
import type { Site, SiteCollection, SiteProperties } from "../../logic/types.ts";
import { useMapCore } from "../../ui/useMapCore.ts";
import { CENTER_MARK } from "../logic/centers.ts";
import { t } from "../../logic/i18n.ts";

interface WarmingMapProps {
  lang: string;
  basemap: BasemapId;
  data: SiteCollection | null;
  /** The centers to draw, when only some of `data` should show. */
  shown?: Site[];
  /** The map exists, drawn in `style`. */
  onReady?: (map: MapCore<SiteProperties>, style: StyleSpecification) => void;
  onSelect?: (feature: Site | null, info: SelectInfo) => void;
  /** The reader clicked, dragged, zoomed or panned the map. Moves the map makes on its
   *  own, such as framing a search result, do not count. */
  onInteract?: () => void;
}

export function WarmingMap({
  lang, basemap, data, shown, onReady, onSelect, onInteract,
}: WarmingMapProps) {
  const { containerRef, create, destroy } = useMapCore<SiteProperties>();
  const [map, setMap] = useState<MapCore<SiteProperties> | null>(null);
  const [failed, setFailed] = useState(false);
  const ready = useEffectEvent(
    (created: MapCore<SiteProperties>, style: StyleSpecification) => onReady?.(created, style));
  const select = useEffectEvent(
    (feature: Site | null, info: SelectInfo) => onSelect?.(feature, info));
  const interact = useEffectEvent(() => onInteract?.());

  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    loadBasemap(basemap, lang)
      .then((style) => {
        if (cancelled) return;
        const created = create({
          style: structuredClone(style), data, pin: CENTER_MARK, counts: true,
          onSelect: (feature, info) => select(feature, info),
        });
        // Only the reader's own input carries an originalEvent. A wheel zoom's movestart
        // carries none, so the wheel is heard on its own.
        created.raw.on("click", () => interact());
        created.raw.on("wheel", () => interact());
        created.raw.on("movestart", (e) => { if (e.originalEvent) interact(); });
        setMap(created);
        ready(created, style);
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
  }, [lang, basemap, data, create, destroy]);

  // Its own effect, so a filter changes the pins without making the map again.
  useEffect(() => {
    if (map && shown) map.setData({ type: "FeatureCollection", features: shown });
  }, [map, shown]);

  return (
    <div className="map" id="map" ref={containerRef}>
      {failed && <p className="load-error"><span>{t("The map could not load.")}</span></p>}
    </div>
  );
}
