import { useEffect, useEffectEvent, useState } from "react";
import { loadBasemap } from "../../core/basemaps/index.ts";
import type { BasemapId } from "../../core/basemaps/names.ts";
import type { StyleSpecification } from "maplibre-gl";
import type { MapCore, SelectInfo } from "../../core/map-core.ts";
import { coincidentWith } from "../../logic/data.ts";
import type { Site, SiteCollection, SiteProperties } from "../../logic/types.ts";
import { keepClearOfList } from "../../ui/layout.ts";
import { useMapCore } from "../../ui/useMapCore.ts";
import { CENTER_PINS } from "../logic/centers.ts";

/** The list's width on a desktop: .side in warming.css. */
const LIST_WIDTH = 360;

interface WarmingMapProps {
  lang: string;
  basemap: BasemapId;
  data: SiteCollection | null;
  /** The centers to draw, when only some of `data` should show. */
  shown?: Site[];
  /** Each center's group of centers at its spot (see logic/data.ts). A pin whose group
   *  has others drawn too carries how many. */
  together?: Map<string, Site[]>;
  /** Keep the camera's centre clear of the list. It can change while the map is showing. */
  padForList?: boolean;
  /** The map exists, drawn in `style`. */
  onReady?: (map: MapCore<SiteProperties>, style: StyleSpecification) => void;
  onSelect?: (feature: Site | null, info: SelectInfo) => void;
  /** Where a selected pin lands, in the map's pixels (see map-core). Its centre unless given. */
  focusPoint?: () => [number, number] | null;
  /** The reader clicked, dragged, zoomed or panned the map. Moves the map makes on its
   *  own, such as framing a search result, do not count. */
  onInteract?: () => void;
}

export function WarmingMap({
  lang, basemap, data, shown, together, padForList = false, onReady, onSelect, focusPoint,
  onInteract,
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
          style: structuredClone(style), data, categories: CENTER_PINS, counts: "here",
          focusPoint,
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
  }, [lang, basemap, data, focusPoint, create, destroy]);

  // Its own effect, so a filter changes the pins without making the map again. Centers at
  // one spot are counted among those drawn, so a filter that hides one changes the count.
  // The count goes on the group's last pin, which the map draws on top; the group's pins
  // can sit metres apart, and one number reads as one spot where several would not.
  useEffect(() => {
    if (!map || !shown) return;
    const drawn = new Set(shown.map((f) => f.properties.id));
    const features = shown.map((f) => {
      const group = together
        ? coincidentWith(together, f).filter((o) => drawn.has(o.properties.id)) : [f];
      const here = group.length;
      return here > 1 && group[here - 1] === f
        ? { ...f, properties: { ...f.properties, here } } : f;
    });
    map.setData({ type: "FeatureCollection", features });
  }, [map, shown, together]);

  // Its own effect, so the list arriving or leaving changes the padding, not the map.
  useEffect(() => {
    if (!map || !padForList) return;
    return keepClearOfList(map, LIST_WIDTH);
  }, [map, padForList]);

  return (
    <div className="map" id="map" tabIndex={-1} ref={containerRef}>
      {failed && <p className="load-error"><span>The map could not load.</span></p>}
    </div>
  );
}
