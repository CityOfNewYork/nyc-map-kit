import type { KeyboardEvent, MouseEvent, ReactNode, Ref, SyntheticEvent } from "react";
import type { LngLat } from "../logic/places.ts";
import type { Model, Site } from "../logic/types.ts";
import { Card } from "./Card.tsx";
import { number, t } from "../logic/i18n.ts";

/** Which stepper arrow was pressed: towards the previous record in the group, or the next. */
export type StepDirection = "prev" | "next";

interface SiteDialogProps {
  ref: Ref<HTMLDialogElement>;
  /** The div the card's small map is drawn into. */
  miniMapElement: Ref<HTMLDivElement>;
  feature: Site | null;
  group: Site[];
  model: Model | null;
  /** Where the reader searched for, or null: the block's own Card says how far away the
   *  site is from it. */
  origin?: LngLat | null;
  onStep: (delta: number, dir: StepDirection) => void;
  onClose: () => void;
  /** The card's content for a site. It must include the heading, id "card-title", that
   *  focus moves to. The block's own Card unless given. */
  card?: (feature: Site) => ReactNode;
  /** A panel beside the list rather than a modal (see useSiteCard's `panel`). */
  panel?: boolean;
}

/**
 * One site's card, as a modal: the same behaviour at every width. It opens centred
 * over a blurred map on a desktop and fills the frame on a phone, so there is one
 * layout to build and test, and nothing on the map moves to make room for it.
 *
 * A native <dialog> opened with showModal() makes everything behind it inert, keeps
 * Tab inside it, and turns Escape into a `cancel` event — the modal contract, from the
 * browser rather than from code. It holds the stepper (chrome for moving between records
 * that share a location), floating above a white box with a small map of the place and
 * the card (always exactly one record). The stepper and the card are siblings, so the
 * card's content is never mixed with the controls around it. Close is last in the box so
 * Tab walks the card first.
 *
 * useSiteCard.ts opens and closes it (showModal / close) and owns what is selected; this
 * file is only its markup. `group` is every record at the selected one's location. The
 * card's content is `card`'s, or the block's own Card.
 */
export function SiteDialog(
  {
    ref, miniMapElement, feature, group, model, origin = null, onStep, onClose, card,
    panel = false,
  }: SiteDialogProps,
) {
  // Escape arrives as `cancel`. Taken over so it closes through history like every other
  // way of closing the card.
  const onCancel = (e: SyntheticEvent<HTMLDialogElement>) => {
    e.preventDefault();
    onClose();
  };
  // The dialog itself is transparent, so a click that lands on it rather than on the
  // stepper or the box is a click on the backdrop around them.
  const onBackdropClick = (e: MouseEvent<HTMLDialogElement>) => {
    if (!panel && e.target === e.currentTarget) onClose();
  };
  // A panel is not modal, so the browser sends no `cancel` for Escape; it is heard here.
  const onKeyDown = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (panel && e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <dialog className={panel ? "site-dialog side-panel" : "site-dialog"} id="site-dialog"
            aria-labelledby="card-title"
            aria-describedby={group.length > 1 ? "step-count" : undefined} ref={ref}
            onCancel={onCancel} onClick={onBackdropClick} onKeyDown={onKeyDown}>
      <Stepper group={group} currentId={feature && feature.properties.id} onStep={onStep} />
      <div className="card-box">
        <div className="mini-map" id="mini-map" ref={miniMapElement} />
        {/* A plain box, not an <article>: inside the dialog, already named for the place,
            an article only made VoiceOver say the name again. */}
        <div className="card" id="card" hidden={!feature}>
          {feature && (card ? card(feature)
            : <Card feature={feature} model={model!} origin={origin} />)}
        </div>
        <button className="card-close" id="card-close" type="button" onClick={onClose}>
          <svg aria-hidden="true" viewBox="0 0 20 20" width="20" height="20">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2.2"
                  strokeLinecap="round" />
          </svg>
          <span className="visually-hidden">{t("Close card")}</span>
        </button>
      </div>
    </dialog>
  );
}

/**
 * More than one record in this site's group: step between them, one card at a time.
 *
 * A stepper rather than a list, because a card has to stay atomic. The list this replaced
 * put N organizations' names inside one organization's card — unbounded height, and at
 * city zoom it was listing pixel neighbours a kilometre away as though they shared an
 * address. A stepper is two arrows and a count: constant height whatever the stack depth,
 * and the card below it is always exactly one site.
 *
 * The count is the part Felt's version omits and ArcGIS's includes, and it is the part
 * that matters — without it there is no way to know a second record is there at all.
 *
 * It wraps rather than disabling at the ends. With a stack of two, disabling would leave
 * one of the two arrows permanently dead; the count already says where you are.
 */
interface StepperProps {
  group: Site[];
  currentId: string | null;
  onStep: SiteDialogProps["onStep"];
}

function Stepper({ group, currentId, onStep }: StepperProps) {
  const show = group.length > 1;
  const index = group.findIndex((f) => f.properties.id === currentId);
  // No role="group": unnamed, VoiceOver names the group by its text and reads the count
  // again on entering ("group") and leaving ("end of group"). The arrows' own labels
  // already say they belong to this location. The count is heard once, as the dialog's
  // description, when the card opens.
  return (
    <div className="stepper" id="stepper" hidden={!show}>
      {show && (
        <>
          <ArrowButton dir="prev" path="M12.5 4.5 7 10l5.5 5.5"
                       label={t("Previous site at this location")} onClick={() => onStep(-1, "prev")} />
          <p className="step-count" id="step-count">
            <span>
              {t("{index} of {count} at this location",
                { index: number(index + 1), count: number(group.length) })}
            </span>
          </p>
          <ArrowButton dir="next" path="M7.5 4.5 13 10l-5.5 5.5"
                       label={t("Next site at this location")} onClick={() => onStep(1, "next")} />
        </>
      )}
    </div>
  );
}

/** One stepper arrow. The chevron (`path`, on a 20-unit square) is decoration; the label
 *  is what is announced. */
interface ArrowButtonProps {
  dir: StepDirection;
  path: string;
  label: string;
  onClick: () => void;
}

function ArrowButton({ dir, path, label, onClick }: ArrowButtonProps) {
  return (
    <button type="button" className={`step step-${dir}`} onClick={onClick}>
      <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16">
        <path d={path} fill="none" stroke="currentColor" strokeWidth="2.4"
              strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="visually-hidden">{label}</span>
    </button>
  );
}
