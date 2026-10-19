import type { Found } from "../../logic/places.ts";
import type { Model, Site } from "../../logic/types.ts";
import { Panel } from "../../ui/Panel.tsx";
import { Search } from "../../ui/Search.tsx";

interface MapPageProps {
  model: Model | null;
  found: Found | null;
  selectedId: string | null;
  onFound: (place: Found) => void;
  onClear: () => void;
  onOpen: (feature: Site) => void;
}

/** The map view's own part: the search box and the list. The map beside them is App's,
 *  shared with the landing view. */
export function MapPage({ model, found, selectedId, onFound, onClear, onOpen }: MapPageProps) {
  return (
    <>
      <h2 className="visually-hidden">Map of warming centers</h2>
      <div className="side">
        <Search onFound={onFound} onClear={onClear} />
        <Panel model={model} list="on" origin={found && found.center} selectedId={selectedId}
               onOpen={(_button, feature) => onOpen(feature)} />
      </div>
    </>
  );
}
