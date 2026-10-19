import type { Found } from "../../logic/places.ts";
import type { Model, Site } from "../../logic/types.ts";
import { CategoryIcon } from "../../ui/CategoryIcon.tsx";
import { Panel } from "../../ui/Panel.tsx";
import { PlaceName, Search } from "../../ui/Search.tsx";
import { MapKey } from "../components/MapKey.tsx";
import { centerKind } from "../logic/centers.ts";

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
               onOpen={(_button, feature) => onOpen(feature)}
               label="Warming centers" summary={<CenterCount model={model} />}
               row={centerRow} marker={centerMarker}
               header={<ListHead model={model} found={found} />} />
      </div>
      <MapKey />
    </>
  );
}

/**
 * Above the rows on a desktop: how many centers there are and, after a search, the place
 * they are ordered from. On a desktop this line stands in for the search box's own (see
 * warming.css), so it is a live region too, and a screen reader hears it without leaving
 * the input. On a phone the sheet's handle carries the count and the search box keeps its
 * line, so this one is hidden.
 */
function ListHead({ model, found }: { model: Model | null; found: Found | null }) {
  return (
    <>
      <p className="list-count"><CenterCount model={model} /></p>
      <div className="list-closest" role="status">
        {found && <p><span>Closest to</span>{" "}<PlaceName place={found} inline /></p>}
      </div>
    </>
  );
}

/** A row's lines: the center's name, what kind of center it is, and its address. A
 *  hospital and the warming bus parked at it share a name and an address, so the kind
 *  is what tells their rows apart. */
function centerRow(feature: Site) {
  const p = feature.properties;
  const kind = centerKind(feature);
  return (
    <>
      <span className="name">{p.org}</span>
      {kind && <span className="type">{kind.label}</span>}
      <span className="addr">{p.address}</span>
    </>
  );
}

/** The icon of a center's kind, as the map key shows it. */
function centerMarker(feature: Site) {
  const kind = centerKind(feature);
  return kind && <CategoryIcon color={kind.color} glyph={kind.glyph} />;
}

/** "26 locations". The singular and the plural are each their own text node, as in the
 *  block's counts (see SiteCounts in ui/App.tsx). */
function CenterCount({ model }: { model: Model | null }) {
  const count = model ? model.features.length : undefined;
  return (
    <>
      <span>{count}</span>{" "}
      <span hidden={count === 1}>locations</span>{" "}
      <span hidden={count !== 1}>location</span>
    </>
  );
}
