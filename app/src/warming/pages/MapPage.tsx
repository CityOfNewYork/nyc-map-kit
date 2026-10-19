import { useRef, useState } from "react";
import type { Found } from "../../logic/places.ts";
import type { Model, Site } from "../../logic/types.ts";
import { CategoryIcon } from "../../ui/CategoryIcon.tsx";
import { Panel } from "../../ui/Panel.tsx";
import { PlaceName, Search } from "../../ui/Search.tsx";
import { CodeBlueNotice } from "../components/CodeBlueNotice.tsx";
import { FilterBar } from "../components/FilterBar.tsx";
import { FilterPanel } from "../components/FilterPanel.tsx";
import { MapKey } from "../components/MapKey.tsx";
import { OpenStatusLine } from "../components/OpenStatusLine.tsx";
import { useNycMinute } from "../components/useNycMinute.ts";
import { centerKind, centerStatus } from "../logic/centers.ts";
import { activeFilters, NO_FILTERS } from "../logic/filters.ts";
import type { Filters } from "../logic/filters.ts";

interface MapPageProps {
  model: Model | null;
  /** The centers the filters leave, in the model's order. */
  shown: Site[];
  filters: Filters;
  onFilters: (filters: Filters) => void;
  found: Found | null;
  selectedId: string | null;
  onFound: (place: Found) => void;
  onClear: () => void;
  /** A row was chosen: the button that was pressed, and its center. */
  onOpen: (button: HTMLElement, feature: Site) => void;
}

/** The map view's own part: the search box with the filters beside it, on a bar above
 *  the map, then the list. On a wide screen the filters are a row of buttons (FilterBar);
 *  narrower, one Filters button opens them all (FilterPanel). The map is App's, shared
 *  with the landing view. */
export function MapPage({
  model, shown, filters, onFilters, found, selectedId, onFound, onClear, onOpen,
}: MapPageProps) {
  const minute = useNycMinute();
  const [filtering, setFiltering] = useState(false);
  const filterButton = useRef<HTMLButtonElement>(null);
  const active = activeFilters(filters);
  // The list shows only what the filters leave; the counts say how many of how many.
  const listed = model && { ...model, features: shown };

  function closeFilters() {
    setFiltering(false);
    filterButton.current?.focus();
  }

  return (
    <>
      <h2 className="visually-hidden" id="map-heading" tabIndex={-1}>Map of warming centers</h2>
      <div className="toolbar">
        <div className="search-row">
          <Search onFound={onFound} onClear={onClear} />
          <button type="button" className="filters-button" ref={filterButton}
                  aria-expanded={filtering} aria-controls="filters"
                  onClick={() => (filtering ? closeFilters() : setFiltering(true))}>
            <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22">
              <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
                <circle cx="16" cy="7" r="2" />
                <circle cx="10" cy="17" r="2" />
              </g>
            </svg>
            <span className="visually-hidden">Filters</span>
            {active > 0 && (
              <span className="filters-count">
                <span>{active}</span>
                <span className="visually-hidden">on</span>
              </span>
            )}
          </button>
          <FilterBar filters={filters} onChange={onFilters} />
        </div>
      </div>
      <div className="side">
        {filtering && (
          <FilterPanel id="filters" filters={filters} shown={shown.length}
                       onChange={onFilters} onClose={closeFilters} />
        )}
        <Panel model={listed} list="on" origin={found && found.center} selectedId={selectedId}
               onOpen={onOpen}
               label="Warming centers" summary={<CenterCount count={listed && shown.length} />}
               row={(feature) => centerRow(feature, minute)} marker={centerMarker}
               header={(
                 <ListHead total={model && model.features.length} shown={shown.length}
                           filtered={active > 0} found={found}
                           onClearFilters={() => onFilters(NO_FILTERS)} />
               )} />
      </div>
      <MapKey />
    </>
  );
}

/**
 * Above the rows: the Code Blue notice, then on a desktop how many centers there are, or
 * with filters on how many of how many, and after a search the place they are ordered
 * from. The count is a live region, so a screen reader hears what a filter left. On a
 * desktop the place line stands in for the search box's own (see warming.css), so it is a
 * live region too, and a screen reader hears it without leaving the input. On a phone the
 * sheet's handle carries the count and the search box keeps its line, so only the notice
 * shows.
 */
function ListHead({ total, shown, filtered, found, onClearFilters }: {
  total: number | null; shown: number; filtered: boolean; found: Found | null;
  onClearFilters: () => void;
}) {
  return (
    <>
      <CodeBlueNotice />
      <p className="list-count" role="status">
        {filtered ? (
          <>
            <span>Showing</span>{" "}<span>{shown}</span>{" "}<span>of</span>{" "}
            <span>{total}</span>{" "}<span>locations</span>
          </>
        ) : <CenterCount count={total} />}
      </p>
      {filtered && shown === 0 && (
        <p className="list-empty">
          <span>No locations match your filters.</span>{" "}
          <button type="button" className="filters-clear" onClick={onClearFilters}>
            <span>Clear filters</span>
          </button>
        </p>
      )}
      <div className="list-closest" role="status">
        {found && <p><span>Closest to</span>{" "}<PlaceName place={found} inline /></p>}
      </div>
    </>
  );
}

/** A row's lines: the center's name, what kind of center it is, whether it is open at
 *  `minute`, and its address. A hospital and the warming bus parked at it share a name
 *  and an address, so the kind is what tells their rows apart. */
function centerRow(feature: Site, minute: number) {
  const p = feature.properties;
  const kind = centerKind(feature);
  const status = centerStatus(feature, minute);
  return (
    <>
      <span className="name">{p.org}</span>
      {kind && <span className="type">{kind.label}</span>}
      {status && <OpenStatusLine status={status} />}
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
function CenterCount({ count }: { count: number | null | undefined }) {
  return (
    <>
      <span>{count ?? undefined}</span>{" "}
      <span hidden={count === 1}>locations</span>{" "}
      <span hidden={count !== 1}>location</span>
    </>
  );
}
