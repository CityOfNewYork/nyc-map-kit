import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { FeatureCollection, LineString } from "geojson";
import { loadBasemap } from "../../core/basemaps/index.ts";
import type { BasemapId } from "../../core/basemaps/names.ts";
import type { ExpressionSpecification, FilterSpecification, StyleSpecification } from "maplibre-gl";
import type { MapCore, SelectInfo } from "../../core/map-core.ts";
import type { Site, SiteCollection, SiteProperties } from "../../logic/types.ts";
import { useMapCore } from "../../ui/useMapCore.ts";
import { EVENT_PINS, SITE_MARK, eventDetails } from "../logic/events.ts";
import { t } from "../../logic/i18n.ts";

interface EventMapProps {
  lang: string;
  basemap: BasemapId;
  data: SiteCollection | null;
  /** The events to draw, when only some of `data` should show. Their streets follow. */
  shown?: Site[];
  /** The map exists, drawn in `style`. */
  onReady?: (map: MapCore<SiteProperties>, style: StyleSpecification) => void;
  onSelect?: (feature: Site | null, info: SelectInfo) => void;
  /** The reader clicked, dragged, zoomed or panned the map. Moves the map makes on its
   *  own, such as framing a search result, do not count. */
  onInteract?: () => void;
}

/** The streets the events close, next to the page. Written by build/trick-or-streets.py,
 *  each with the `event` id it belongs to. */
const STREETS = "trick-or-streets/streets.geojson";

/** The pumpkins' orange (see EVENT_KINDS), 3:1 against the basemap's land. */
const STREET_COLOR = "#e2550a";

/** The streets' widths, by zoom: a thread across the city, a band along one block; and
 *  the glow under them, three times as wide. MapLibre takes the zoom only at the top of
 *  an expression, so the glow has stops of its own. */
const STOPS: [number, number][] = [[10, 2], [13, 3.5], [16, 7], [18, 12]];
const width = (k: number): ExpressionSpecification =>
  ["interpolate", ["linear"], ["zoom"], ...STOPS.flatMap(([z, w]) => [z, w * k])];

/** The glow under each street, then the street itself. */
const STREET_LAYERS = ["street-glow", "streets"];

/** Whether an event is one of DOT's few Signature events, drawn over the rest. */
const isSignature = (f: Site) => eventDetails(f).type === "signature";

/** The pins in the order they are drawn: the ghosts last, so over the pumpkins, as DOT's
 *  map draws them; and among each, north to south, so a pin lower on the screen covers
 *  the tip of the one above it, as the core stacks pins when nothing sorts them. */
function drawOrder(features: Site[]): Site[] {
  const lat = (f: Site) => f.geometry.coordinates[1];
  return [...features].sort((a, b) =>
    Number(isSignature(a)) - Number(isSignature(b)) || lat(b) - lat(a));
}

/** Only the streets of the events in `ids`, or every street while `ids` is null. */
function streetFilter(ids: string[] | null): FilterSpecification {
  return ids ? ["in", ["get", "event"], ["literal", ids]] : ["boolean", true];
}

/** The streets, under the searched-for place and the pins (the core adds the place's
 *  layers first, so the streets go before them), showing those of the events in `ids`. */
function addStreets(
  map: MapCore<SiteProperties>, streets: FeatureCollection<LineString>, ids: string[] | null,
) {
  const raw = map.raw;
  const filter = streetFilter(ids);
  raw.addSource("streets", { type: "geojson", data: streets });
  raw.addLayer({
    id: "street-glow", type: "line", source: "streets", filter,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": STREET_COLOR, "line-opacity": 0.3, "line-blur": 3, "line-width": width(3),
    },
  }, "place-halo");
  raw.addLayer({
    id: "streets", type: "line", source: "streets", filter,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": STREET_COLOR, "line-width": width(1) },
  }, "place-halo");
}

/**
 * The map: every event as a ghost or a jack-o'-lantern (EVENT_PINS), and under them the
 * streets the events close, in the pumpkins' orange with a soft glow, as DOT's own map
 * draws them. The streets are drawn, not clickable: a pin opens an event's card. They
 * follow the filters by the `event` each one carries, and a map whose streets fail to
 * load still shows every event.
 */
export function EventMap({
  lang, basemap, data, shown, onReady, onSelect, onInteract,
}: EventMapProps) {
  const { containerRef, create, destroy } = useMapCore<SiteProperties>();
  const [map, setMap] = useState<MapCore<SiteProperties> | null>(null);
  const [failed, setFailed] = useState(false);
  // The events shown, for streets that arrive after the filters changed.
  const shownIds = useRef<string[] | null>(null);
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
          style: structuredClone(style), data: { ...data, features: drawOrder(data.features) },
          pin: SITE_MARK, categories: EVENT_PINS,
          counts: true,
          onSelect: (feature, info) => select(feature, info),
        });
        // Only the reader's own input carries an originalEvent. A wheel zoom's movestart
        // carries none, so the wheel is heard on its own.
        created.raw.on("click", () => interact());
        created.raw.on("wheel", () => interact());
        created.raw.on("movestart", (e) => { if (e.originalEvent) interact(); });
        created.ready(() => {
          // The core's pins stack by their height on the screen; a sort key makes them
          // keep the draw order instead.
          created.raw.setLayoutProperty("sites", "symbol-sort-key",
            ["case", ["==", ["get", "type"], "signature"], 1, 0]);
          fetch(STREETS)
            .then((resp) => {
              if (!resp.ok) throw new Error(`${STREETS} returned ${resp.status}`);
              return resp.json() as Promise<FeatureCollection<LineString>>;
            })
            .then((streets) => {
              if (!cancelled) addStreets(created, streets, shownIds.current);
            })
            .catch((err) => console.error(err));
        });
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

  // Its own effect, so a filter changes the pins and the streets without making the map
  // again.
  useEffect(() => {
    if (!map || !shown) return;
    map.setData({ type: "FeatureCollection", features: drawOrder(shown) });
    shownIds.current = shown.map((f) => f.properties.id);
    for (const id of STREET_LAYERS) {
      if (map.raw.getLayer(id)) map.raw.setFilter(id, streetFilter(shownIds.current));
    }
  }, [map, shown]);

  return (
    <div className="map" id="map" ref={containerRef}>
      {failed && <p className="load-error"><span>{t("The map could not load.")}</span></p>}
    </div>
  );
}
