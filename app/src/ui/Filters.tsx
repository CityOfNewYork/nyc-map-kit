import { useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode, Ref, SyntheticEvent } from "react";
import { number, plural, t } from "../logic/i18n.ts";

interface FiltersButtonProps {
  ref: Ref<HTMLButtonElement>;
  /** The id of the panel it opens. */
  controls: string;
  open: boolean;
  /** How many filters are on, shown as a badge on the button's corner when any are. */
  active: number;
  onClick: () => void;
}

/** Two sliders: the mark of a control that opens filters. Decorative. */
export function FiltersIcon({ size = 22 }: { size?: number }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size}>
      <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
        <circle cx="16" cy="7" r="2" />
        <circle cx="10" cy="17" r="2" />
      </g>
    </svg>
  );
}

/** The round Filters button beside the search box. */
export function FiltersButton({ ref, controls, open, active, onClick }: FiltersButtonProps) {
  return (
    <button type="button" className="filters-button" ref={ref}
            aria-expanded={open} aria-controls={controls} onClick={onClick}>
      <FiltersIcon />
      <span className="visually-hidden">{t("Filters")}</span>
      {active > 0 && (
        <span className="filters-count">
          <span aria-hidden="true">{number(active)}</span>
          <span className="visually-hidden">{plural(active, "{n} filter on", "{n} filters on")}</span>
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
 * applies at once, to the list and the map together. Escape closes it too. The panel is
 * no taller than the room it has: the heading and the buttons stay put, and the filters
 * scroll between them.
 *
 * On a desktop it opens under the search box, in the column, with the map still in use.
 * On a phone it is a modal card over the blurred map, as the site card is: showModal()
 * keeps keyboard and screen-reader focus inside it until it closes.
 */
export function FiltersPanel({ id, shown, onClear, onClose, children }: FiltersPanelProps) {
  const panel = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  // A layout effect, so it is open before the browser first paints it.
  useLayoutEffect(() => {
    const dialog = panel.current!;
    if (matchMedia("(min-width: 768px)").matches) dialog.show();
    else dialog.showModal();
    heading.current?.focus();
    return () => dialog.close();
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLDialogElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }
  // The browser's own close of a modal dialog, which some keep for a back gesture.
  function onCancel(e: SyntheticEvent<HTMLDialogElement>) {
    e.preventDefault();
    onClose();
  }

  return (
    <dialog className="filters-panel" id={id} ref={panel} aria-labelledby={`${id}-title`}
            onKeyDown={onKeyDown} onCancel={onCancel}>
      <div className="filters-head">
        <h3 id={`${id}-title`} ref={heading} tabIndex={-1}>{t("Filters")}</h3>
        <button type="button" className="filters-close" onClick={onClose}>
          <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2.2"
                  strokeLinecap="round" />
          </svg>
          <span className="visually-hidden">{t("Close the filters")}</span>
        </button>
      </div>

      <div className="filters-body">{children}</div>

      <div className="filters-foot">
        <button type="button" className="filters-clear" onClick={onClear}>
          <span>{t("Clear filters")}</span>
        </button>
        <button type="button" className="filters-show" onClick={onClose}>
          <span>{plural(shown, "Show {n} location", "Show {n} locations")}</span>
        </button>
      </div>
    </dialog>
  );
}

interface FilterDisclosureProps {
  /** The filter's name: "Location type". */
  label: string;
  /** How many of its options are checked, shown on the button when any are. */
  chosen: number;
  /** Its options: checkboxes, say. */
  children: ReactNode;
}

/**
 * A filter with several options, in the panel: one button that shows or hides them. A
 * keyboard user tabs from filter to filter, and into a filter's options only after
 * opening it; a screen reader hears the filter's name as the group's.
 */
export function FilterDisclosure({ label, chosen, children }: FilterDisclosureProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="filter-disclosure">
      <button type="button" aria-expanded={open} aria-controls={id}
              onClick={() => setOpen((o) => !o)}>
        <span>{label}</span>
        {chosen > 0 && (
          <span className="filter-chosen">
            <span aria-hidden="true">{number(chosen)}</span>
            <span className="visually-hidden">{plural(chosen, "{n} chosen", "{n} chosen")}</span>
          </span>
        )}
        <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14">
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <fieldset id={id} hidden={!open}>
        <legend className="visually-hidden">{label}</legend>
        {children}
      </fieldset>
    </div>
  );
}
