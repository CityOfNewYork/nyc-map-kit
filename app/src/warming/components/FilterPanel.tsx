import { useEffect, useRef } from "react";
import type { KeyboardEvent } from "react";
import { track } from "../../logic/analytics.ts";
import { CategoryIcon } from "../../ui/CategoryIcon.tsx";
import { CENTER_KINDS } from "../logic/centers.ts";
import { NO_FILTERS } from "../logic/filters.ts";
import type { Filters } from "../logic/filters.ts";
import { FilterToggles } from "./FilterBar.tsx";

interface FilterPanelProps {
  id: string;
  filters: Filters;
  /** How many centers the filters leave. */
  shown: number;
  onChange: (filters: Filters) => void;
  /** Done: close the panel. Focus goes back to the Filters button. */
  onClose: () => void;
}

/**
 * The filters, opened from the Filters button beside the search box: the kinds of center,
 * then open now, wheelchair access and pets as the same toggles the bar shows. Each
 * change applies at once, to the list and the map together; "Show n locations" closes
 * the panel on the result. Under the search box on a desktop, the whole screen on a
 * phone. Escape closes it too.
 */
export function FilterPanel({ id, filters, shown, onChange, onClose }: FilterPanelProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  function set(next: Partial<Filters>, filter: string, value: string | boolean) {
    onChange({ ...filters, ...next });
    track("map_filter", { filter, value });
  }
  function toggleType(type: string, on: boolean) {
    const types = on ? [...filters.types, type] : filters.types.filter((t) => t !== type);
    set({ types }, "type", `${type}:${on}`);
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div className="filters-panel" id={id} role="group" aria-labelledby={`${id}-title`}
         onKeyDown={onKeyDown}>
      <div className="filters-head">
        <h3 id={`${id}-title`} ref={heading} tabIndex={-1}>Filters</h3>
        <button type="button" className="filters-close" onClick={onClose}>
          <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2.2"
                  strokeLinecap="round" />
          </svg>
          <span className="visually-hidden">Close the filters</span>
        </button>
      </div>

      <fieldset>
        <legend>Location type</legend>
        {[...CENTER_KINDS].map(([type, kind]) => (
          <label key={type} className="filter-check">
            <input type="checkbox" checked={filters.types.includes(type)}
                   onChange={(e) => toggleType(type, e.target.checked)} />
            <CategoryIcon color={kind.color} glyph={kind.glyph} />
            <span>{kind.label}</span>
          </label>
        ))}
      </fieldset>

      <div className="filter-toggles">
        <FilterToggles filters={filters} set={set} />
      </div>

      <div className="filters-foot">
        <button type="button" className="filters-clear"
                onClick={() => { onChange(NO_FILTERS); track("map_filter", { filter: "clear" }); }}>
          <span>Clear filters</span>
        </button>
        {/* The singular and the plural are each their own text node (see SiteCounts in
            ui/App.tsx). */}
        <button type="button" className="filters-show" onClick={onClose}>
          <span>Show</span>{" "}<span>{shown}</span>{" "}
          <span hidden={shown === 1}>locations</span>
          <span hidden={shown !== 1}>location</span>
        </button>
      </div>
    </div>
  );
}
