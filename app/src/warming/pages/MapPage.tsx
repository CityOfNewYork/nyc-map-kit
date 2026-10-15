import { useEffect, useRef, useState } from "react";
import type { MapCore } from "../../core/map-core.ts";
import { nearestIds } from "../../logic/data.ts";
import type { Found } from "../../logic/places.ts";
import type { Model, SiteProperties } from "../../logic/types.ts";
import { Panel } from "../../ui/Panel.tsx";
import { Search } from "../../ui/Search.tsx";
import { WarmingMap } from "../components/WarmingMap.tsx";

interface MapPageProps {
  lang: string;
  model: Model | null;
  found: Found | null;
  onFound: (place: Found) => void;
  onClear: () => void;
}

export function MapPage({ lang, model, found, onFound, onClear }: MapPageProps) {
  const mapRef = useRef<MapCore<SiteProperties> | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (mapRef.current) showFound(mapRef.current, found, model);
  }, [found, model]);

  function onMapReady(map: MapCore<SiteProperties>) {
    mapRef.current = map;
    showFound(map, found, model);
  }

  return (
    <div className="stage" data-list="on">
      <h2 className="visually-hidden">Map of warming centers</h2>
      <div className="side">
        <Search onFound={onFound} onClear={onClear} />
        <Panel model={model} list="on" origin={found && found.center} selectedId={selectedId}
               onOpen={(_button, feature) => mapRef.current?.select(feature.properties.id)} />
      </div>
      <WarmingMap lang={lang} data={model && model.data} padForList
                  onReady={onMapReady} onSelect={(feature) => setSelectedId(feature && feature.properties.id)} />
    </div>
  );
}

/** Mark the searched place and frame it with the sites nearest it, or clear the mark. */
function showFound(map: MapCore<SiteProperties>, found: Found | null, model: Model | null) {
  if (!found) {
    map.showPlace(null);
    return;
  }
  map.showPlace({ center: found.center, bbox: found.bbox },
                model ? nearestIds(model.features, found.center) : []);
}
