import { useRef, useState } from "react";
import type { Found } from "../../logic/places.ts";
import type { Model, Site } from "../../logic/types.ts";
import { CopyLink } from "../../ui/Card.tsx";
import { FiltersButton } from "../../ui/Filters.tsx";
import { Panel } from "../../ui/Panel.tsx";
import { Search } from "../../ui/Search.tsx";
import { siteUrl } from "../../ui/useSiteCard.ts";
import { centerMarker, centerRow } from "../components/CenterRow.tsx";
import { CodeBlueNotice } from "../components/CodeBlueNotice.tsx";
import { FilterBar } from "../components/FilterBar.tsx";
import { FilterPanel } from "../components/FilterPanel.tsx";
import { useNycMinute } from "../components/useNycMinute.ts";
import { activeFilters, NO_FILTERS } from "../logic/filters.ts";
import type { Filters } from "../logic/filters.ts";
import { number, plural, t } from "../../logic/i18n.ts";

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
      <h1 className="visually-hidden" id="map-heading" tabIndex={-1}
          data-card-return>{t("Map of warming centers")}</h1>
      <div className="toolbar">
        {/* One search landmark for the box and the filters: HTML's <search> covers "a
            search or filtering operation". */}
        <div className="search-row" role="search">
          <Search onFound={onFound} onClear={onClear} landmark={false} />
          <FiltersButton ref={filterButton} controls="filters" open={filtering} active={active}
                         onClick={() => (filtering ? closeFilters() : setFiltering(true))} />
          <FilterBar filters={filters} onChange={onFilters} />
        </div>
        {/* The count again, as a live region the eye does not see, so a screen reader
            hears what a filter left. Here, not in the list, which a shut list hides. */}
        <p className="visually-hidden" role="status">
          <ListCount total={model && model.features.length} shown={shown.length}
                     filtered={active > 0} />
        </p>
      </div>
      <div className="side">
        {filtering && (
          <FilterPanel id="filters" filters={filters} shown={shown.length}
                       onChange={onFilters} onClose={closeFilters} />
        )}
        <Panel model={listed} list="on" found={found} selectedId={selectedId}
               onClearFilters={active > 0 ? () => onFilters(NO_FILTERS) : undefined}
               onOpen={onOpen} intro={<CodeBlueNotice />}
               label={t("Warming centers")}
               summary={<ListCount total={model && model.features.length} shown={shown.length}
                                   filtered={active > 0} />}
               action={<CopyLink key={JSON.stringify(filters)} url={resultsUrl}
                                 payload={{ via: "list" }} label="Share results" />}
               row={(feature) => centerRow(feature, minute)} marker={centerMarker} />
      </div>
    </>
  );
}

/** The map view as it is now, with its filters and language, but without an open
 *  center's card, which has a Share result of its own: what the list's Share results
 *  copies. */
function resultsUrl(): URL {
  const url = siteUrl(null);
  url.searchParams.set("view", "map");
  return url;
}

/** How many centers there are, or with filters on how many of how many: the list's top
 *  line, which hides and shows the list (see ui/Panel.tsx). */
function ListCount({ total, shown, filtered }: {
  total: number | null; shown: number; filtered: boolean;
}) {
  return filtered ? (
    <span>
      {plural(total ?? 0, "Showing {shown} of {n} location", "Showing {shown} of {n} locations",
        { shown: number(shown) })}
    </span>
  ) : <CenterCount count={total} />;
}

/** "26 locations", in the form the language gives that number. Nothing until the data
 *  is in. */
function CenterCount({ count }: { count: number | null | undefined }) {
  return count == null ? null : <span>{plural(count, "{n} location", "{n} locations")}</span>;
}
