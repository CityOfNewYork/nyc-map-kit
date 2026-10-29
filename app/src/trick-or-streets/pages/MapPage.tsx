import { useRef, useState } from "react";
import type { Found } from "../../logic/places.ts";
import type { Model, Site } from "../../logic/types.ts";
import { CopyLink } from "../../ui/Card.tsx";
import { FiltersButton } from "../../ui/Filters.tsx";
import { Panel } from "../../ui/Panel.tsx";
import { Search } from "../../ui/Search.tsx";
import { siteUrl } from "../../ui/useSiteCard.ts";
import { eventMarker, eventRow } from "../components/EventRow.tsx";
import { EventsNotice } from "../components/EventsNotice.tsx";
import { FilterBar } from "../components/FilterBar.tsx";
import { FilterPanel } from "../components/FilterPanel.tsx";
import { useNycNow } from "../components/useNycNow.ts";
import { activeFilters, NO_FILTERS } from "../logic/filters.ts";
import type { Filters } from "../logic/filters.ts";
import { language, number, plural, t } from "../../logic/i18n.ts";

interface MapPageProps {
  model: Model | null;
  /** The events the filters leave, in the order the list shows them. */
  shown: Site[];
  filters: Filters;
  onFilters: (filters: Filters) => void;
  found: Found | null;
  selectedId: string | null;
  onFound: (place: Found) => void;
  onClear: () => void;
  /** A row was chosen: the button that was pressed, and its event. */
  onOpen: (button: HTMLElement, feature: Site) => void;
}

/** The map view's own part: the search box with the filters beside it, on a bar above
 *  the map, then the list. On a desktop or tablet the filters are a row of buttons
 *  (FilterBar); on a phone, one Filters button opens them all (FilterPanel). The map is
 *  App's, shared with the landing view. */
export function MapPage({
  model, shown, filters, onFilters, found, selectedId, onFound, onClear, onOpen,
}: MapPageProps) {
  const now = useNycNow();
  const [filtering, setFiltering] = useState(false);
  const filterButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);   // the button that opened the filters
  const active = activeFilters(filters);
  // The list shows only what the filters leave; the counts say how many of how many.
  const listed = model && { ...model, features: shown };

  /** Filters on a phone, More filters on a desktop: open the filters panel, or close it. */
  function toggleFilters(button: HTMLButtonElement) {
    if (filtering) return closeFilters();
    opener.current = button;
    setFiltering(true);
  }
  function closeFilters() {
    setFiltering(false);
    opener.current?.focus();
  }

  return (
    <>
      <h1 className="visually-hidden" id="map-heading" tabIndex={-1}
          data-card-return>{t("Map of Trick-or-Streets events")}</h1>
      <div className="toolbar">
        {/* One search landmark for the box and the filters: HTML's <search> covers "a
            search or filtering operation". */}
        <div className="search-row" role="search">
          <Search onFound={onFound} onClear={onClear} landmark={false} />
          <FiltersButton ref={filterButton} controls="filters" open={filtering} active={active}
                         onClick={() => toggleFilters(filterButton.current!)} />
          {/* Made again in a new language, to measure its words (see FilterBar). */}
          <FilterBar key={language()} filters={filters} onChange={onFilters}
                     onMore={toggleFilters} moreOpen={filtering} />
        </div>
        {/* Share map at the bar's end on a desktop or tablet; a phone has it in the list's
            top line instead (see warming.css). Outside the search landmark: it shares the
            map rather than searching it. */}
        <div className="share-map">
          <CopyLink key={JSON.stringify(filters)} url={resultsUrl} label="Share map" />
        </div>
        {/* The count again, as a live region the eye does not see, so a screen reader
            hears what a filter left. Here, not in the list, which a shut list hides. */}
        <p className="visually-hidden" role="status">
          <ListCount total={model && model.features.length} shown={shown.length}
                     filtered={active > 0} />
        </p>
      </div>
      {/* After the bar in the tab order: a panel at the map's right on a desktop, and a
          modal card on a phone (see warming.css). */}
      {filtering && (
        <FilterPanel id="filters" filters={filters} shown={shown.length}
                     onChange={onFilters} onClose={closeFilters} />
      )}
      <div className="side">
        <Panel model={listed} list="on" found={found} selectedId={selectedId}
               onClearFilters={active > 0 ? () => onFilters(NO_FILTERS) : undefined}
               onOpen={onOpen} intro={<EventsNotice />}
               label={t("Trick-or-Streets events")}
               summary={<ListCount total={model && model.features.length} shown={shown.length}
                                   filtered={active > 0} />}
               action={<CopyLink key={JSON.stringify(filters)} url={resultsUrl}
                                 label="Share map" />}
               row={(feature) => eventRow(feature, now)} marker={eventMarker} inOrder />
      </div>
    </>
  );
}

/** The map view as it is now, with its filters and language, but without an open
 *  event's card, which has a Share result of its own: what Share map copies. */
function resultsUrl(): URL {
  const url = siteUrl(null);
  url.searchParams.set("view", "map");
  return url;
}

/** How many events there are, or with filters on how many of how many: the list's top
 *  line, which hides and shows the list (see ui/Panel.tsx). */
function ListCount({ total, shown, filtered }: {
  total: number | null; shown: number; filtered: boolean;
}) {
  return filtered ? (
    <span>
      {plural(total ?? 0, "Showing {shown} of {n} event", "Showing {shown} of {n} events",
        { shown: number(shown) })}
    </span>
  ) : <EventCount count={total} />;
}

/** "177 events", in the form the language gives that number. Nothing until the data is
 *  in. */
function EventCount({ count }: { count: number | null | undefined }) {
  return count == null ? null : <span>{plural(count, "{n} event", "{n} events")}</span>;
}
