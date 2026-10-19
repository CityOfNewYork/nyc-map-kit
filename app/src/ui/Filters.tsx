import { useEffect, useRef } from "react";
import type { KeyboardEvent, ReactNode, Ref } from "react";

interface FiltersButtonProps {
  ref: Ref<HTMLButtonElement>;
  /** The id of the panel it opens. */
  controls: string;
  open: boolean;
  /** How many filters are on, shown as a badge on the button's corner when any are. */
  active: number;
  onClick: () => void;
}

/** The round Filters button beside the search box. */
export function FiltersButton({ ref, controls, open, active, onClick }: FiltersButtonProps) {
  return (
    <button type="button" className="filters-button" ref={ref}
            aria-expanded={open} aria-controls={controls} onClick={onClick}>
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
  );
}

interface FiltersPanelProps {
  id: string;
  /** How many sites the filters leave. */
  shown: number;
  /** Clear filters: every filter off. */
  onClear: () => void;
  /** Done: close the panel. Focus goes back to the Filters button. */
  onClose: () => void;
  /** The filters themselves: fieldsets of checkboxes, say. */
  children: ReactNode;
}

/**
 * The panel the Filters button opens: a heading and a close button, the filters, then
 * Clear filters and "Show n locations", which closes the panel on the result. Each change
 * applies at once, to the list and the map together. Under the search box on a desktop,
 * the whole screen on a phone. Escape closes it too.
 */
export function FiltersPanel({ id, shown, onClear, onClose, children }: FiltersPanelProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

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

      {children}

      <div className="filters-foot">
        <button type="button" className="filters-clear" onClick={onClear}>
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
