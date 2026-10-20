import type { LngLat } from "../../logic/places.ts";
import type { Model, Site } from "../../logic/types.ts";
import { Card } from "../../ui/Card.tsx";
import { CategoryIcon } from "../../ui/CategoryIcon.tsx";
import { centerDetails, centerKind, centerStatus } from "../logic/centers.ts";
import { clockTime, minutesOf } from "../logic/hours.ts";
import { PawIcon, WheelchairIcon } from "./FeatureIcons.tsx";
import { OpenStatusLine } from "./OpenStatusLine.tsx";
import { useNycMinute } from "./useNycMinute.ts";
import { t } from "../../logic/i18n.ts";

interface CenterCardProps {
  feature: Site;
  model: Model;
  /** Where the reader searched for, or null. */
  origin: LngLat | null;
}

/**
 * One warming center's card: the block's Card (ui/Card.tsx), configured by CENTER_CONFIG,
 * with what only a warming center has — its kind, wheelchair access and pets under the
 * name, whether it is open now, and its hours worked out from its opening and closing
 * times.
 */
export function CenterCard({ feature, model, origin }: CenterCardProps) {
  const details = centerDetails(feature);
  const kind = centerKind(feature);
  const status = centerStatus(feature, useNycMinute());
  const showMeta = kind || details.wheelchair || details.pets;
  return (
    <Card feature={feature} model={model} origin={origin}
          meta={showMeta && (
            <>
              {kind && (
                <span className="card-meta-item">
                  <CategoryIcon color={kind.color} glyph={kind.glyph} />
                  <span>{t(kind.label)}</span>
                </span>
              )}
              {details.wheelchair && (
                <span className="card-meta-item"><WheelchairIcon /><span>{t("Wheelchair accessible")}</span></span>
              )}
              {details.pets && (
                <span className="card-meta-item"><PawIcon /><span>{t("Pets allowed")}</span></span>
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
  if (to - from === 24 * 60 || from === to) {
    return <span>{t("Open 24 hours, 7 days a week")}</span>;
  }
  return <span>{t("{from} – {to}, every day", { from: clockTime(from), to: clockTime(to) })}</span>;
}
