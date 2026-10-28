import type { ReactNode } from "react";
import { number, t } from "../logic/i18n.ts";
import type { Site } from "../logic/types.ts";

const METRES_PER_MILE = 1609.344;

interface SiteRowProps {
  feature: Site;
  /** A row's lines above the distance. The site's name and address unless given. */
  row?: (feature: Site) => ReactNode;
  /** A mark before the lines, such as an icon of the site's kind. None unless given. */
  marker?: (feature: Site) => ReactNode;
  /** How far the site is from the place searched for. No distance unless given. */
  metres?: number | null;
  /** The site whose card is open. */
  current?: boolean;
  onClick: (button: HTMLElement) => void;
}

/**
 * One site as a row that opens its card: in the list (Panel.tsx), and in the pop-up that
 * offers the sites at one place (SiteDialog.tsx). Its lines are the app's `row`, or the
 * site's name and address, then the distance, in its own elements: the number, then "mi"
 * for the eye and "miles" for a screen reader, then "away".
 */
export function SiteRow({ feature, row, marker, metres = null, current = false, onClick }: SiteRowProps) {
  const p = feature.properties;
  const lines = (
    <>
      {row ? row(feature) : (
        <>
          <span className="name">{p.org}</span>
          <span className="addr">{p.address}</span>
        </>
      )}
      {metres != null && (
        <span className="dist">
          <span aria-hidden="true">{t("{miles} mi away", { miles: miles(metres) })}</span>
          <span className="visually-hidden">
            {t("{miles} miles away", { miles: miles(metres) })}
          </span>
        </span>
      )}
    </>
  );
  return (
    <button type="button" className={marker ? "site-button marked" : "site-button"}
            data-site-id={p.id} aria-current={current ? "true" : undefined}
            onClick={(e) => onClick(e.currentTarget)}>
      {marker ? (
        <>
          <span className="site-marker">{marker(feature)}</span>
          <span className="site-lines">{lines}</span>
        </>
      ) : lines}
    </button>
  );
}

/** One decimal place; never "0.0", which would read as "here". */
function miles(metres: number): string {
  return number(Math.max(0.1, metres / METRES_PER_MILE), 1);
}
