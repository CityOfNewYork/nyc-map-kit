import type { LngLat } from "../../logic/places.ts";
import type { Model, Site } from "../../logic/types.ts";
import { Card } from "../../ui/Card.tsx";
import { CategoryIcon } from "../../ui/CategoryIcon.tsx";
import { centerDetails, centerKind, centerStatus } from "../logic/centers.ts";
import { clockTime, minutesOf } from "../logic/hours.ts";
import { OpenStatusLine } from "./OpenStatusLine.tsx";
import { useNycMinute } from "./useNycMinute.ts";

interface CenterCardProps {
  feature: Site;
  model: Model;
  /** Where the reader searched for, or null. */
  origin: LngLat | null;
  lang: string;
}

/**
 * One warming center's card: the block's Card (ui/Card.tsx), configured by CENTER_CONFIG,
 * with what only a warming center has — its kind, wheelchair access and pets under the
 * name, whether it is open now, and its hours worked out from its opening and closing
 * times.
 */
export function CenterCard({ feature, model, origin, lang }: CenterCardProps) {
  const details = centerDetails(feature);
  const kind = centerKind(feature);
  const status = centerStatus(feature, useNycMinute());
  const showMeta = kind || details.wheelchair || details.pets;
  return (
    <Card feature={feature} model={model} lang={lang} origin={origin}
          meta={showMeta && (
            <>
              {kind && (
                <span className="card-meta-item">
                  <CategoryIcon color={kind.color} glyph={kind.glyph} />
                  <span>{kind.label}</span>
                </span>
              )}
              {details.wheelchair && (
                <span className="card-meta-item"><WheelchairIcon /><span>Wheelchair accessible</span></span>
              )}
              {details.pets && (
                <span className="card-meta-item"><PawIcon /><span>Pets allowed</span></span>
              )}
            </>
          )}
          status={status && <OpenStatusLine status={status} />}
          hours={<Hours opens={details.opens} closes={details.closes} />} />
  );
}

/** "8 AM – 10 PM, every day", or "Open 24 hours, 7 days a week". Nothing when the
 *  times cannot be read. */
function Hours({ opens, closes }: { opens?: string; closes?: string }) {
  const from = minutesOf(opens);
  const to = minutesOf(closes);
  if (from === null || to === null) return null;
  if (to - from === 24 * 60 || from === to) return <span>Open 24 hours, 7 days a week</span>;
  return (
    <>
      <span>{clockTime(from)}</span> – <span>{clockTime(to)}</span>,{" "}<span>every day</span>
    </>
  );
}

// Icons. Decorative: the text beside each says what it means.

function WheelchairIcon() {
  return (
    <svg className="card-meta-icon" aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
      <circle cx="12.5" cy="3.8" r="2" fill="currentColor" />
      <path d="M11.5 7.5v6h5l2.5 5.5M11.5 10.5h4.5" fill="none" stroke="currentColor"
            strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.6 10.6a6 6 0 1 0 7.9 8" fill="none" stroke="currentColor" strokeWidth="2.2"
            strokeLinecap="round" />
    </svg>
  );
}

function PawIcon() {
  return (
    <svg className="card-meta-icon" aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"
         fill="currentColor">
      <ellipse cx="6" cy="10" rx="2.2" ry="2.8" />
      <ellipse cx="18" cy="10" rx="2.2" ry="2.8" />
      <ellipse cx="9.5" cy="5.5" rx="2.2" ry="2.8" />
      <ellipse cx="14.5" cy="5.5" rx="2.2" ry="2.8" />
      <path d="M12 11.5c-3 0-6 4.5-6 7a2.5 2.5 0 0 0 3.5 2.2c1.6-.6 3.4-.6 5 0A2.5 2.5 0 0 0 18 18.5c0-2.5-3-7-6-7z" />
    </svg>
  );
}
