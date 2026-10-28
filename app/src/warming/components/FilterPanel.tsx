import { track } from "../../logic/analytics.ts";
import { Check } from "../../ui/Check.tsx";
import { FilterDisclosure, FiltersPanel } from "../../ui/Filters.tsx";
import { CENTER_KINDS } from "../logic/centers.ts";
import { NO_FILTERS } from "../logic/filters.ts";
import type { Filters } from "../logic/filters.ts";
import { FilterToggles } from "./FilterBar.tsx";
import { t } from "../../logic/i18n.ts";

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
 * The warming filters in the kit's panel (ui/Filters.tsx), in the bar's order: open now,
 * wheelchair access and pets, as the same toggles the bar shows, then the kinds of
 * center, which the bar keeps under More filters.
 */
export function FilterPanel({ id, filters, shown, onChange, onClose }: FilterPanelProps) {
  function set(next: Partial<Filters>, filter: string, value: string | boolean) {
    onChange({ ...filters, ...next });
    track("map_filter", { filter, value });
  }
  function toggleType(type: string, on: boolean) {
    const types = on ? [...filters.types, type] : filters.types.filter((t) => t !== type);
    set({ types }, "type", `${type}:${on}`);
  }
  function clear() {
    onChange(NO_FILTERS);
    track("map_filter", { filter: "clear" });
  }

  return (
    <FiltersPanel id={id} shown={shown} onClear={clear} onClose={onClose}>
      <div className="filter-toggles">
        <FilterToggles filters={filters} set={set} />
      </div>

      <FilterDisclosure label={t("Location type")} chosen={filters.types.length}>
        {[...CENTER_KINDS].map(([type, kind]) => (
          <Check key={type} className="filter-check" checked={filters.types.includes(type)}
                 onChange={(on) => toggleType(type, on)}>
            {t(kind.label)}
          </Check>
        ))}
      </FilterDisclosure>
    </FiltersPanel>
  );
}
