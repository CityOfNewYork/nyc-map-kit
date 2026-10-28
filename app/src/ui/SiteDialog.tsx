import type { MouseEvent, ReactNode, Ref, SyntheticEvent } from "react";
import type { LngLat } from "../logic/places.ts";
import type { Model, Site } from "../logic/types.ts";
import { Card } from "./Card.tsx";
import { SiteRow } from "./SiteRow.tsx";
import { number, plural, t } from "../logic/i18n.ts";

/** Which stepper arrow was pressed: towards the previous record in the group, or the next. */
export type StepDirection = "prev" | "next";

interface SiteDialogProps {
  ref: Ref<HTMLDialogElement>;
  /** The div the card's small map is drawn into. */
  miniMapElement: Ref<HTMLDivElement>;
  feature: Site | null;
  group: Site[];
  /** The sites a pin holds, to choose one from before any card opens; [] for none. */
  choices?: Site[];
  /** A site was picked from `choices`. */
  onChoose?: (feature: Site) => void;
  /** How the list of choices says and draws them, as the app's list does: its heading
   *  for `n` sites ("2 sites" unless given), a line under it, and each row's lines and
   *  mark (see SiteRow). */
  choosing?: ChoosingProps;
  model: Model | null;
  /** Where the reader searched for, or null: the block's own Card says how far away the
   *  site is from it. */
  origin?: LngLat | null;
  onStep: (delta: number, dir: StepDirection) => void;
  onClose: () => void;
  /** The card's content for a site. It must include the heading, id "card-title", that
   *  focus moves to. The block's own Card unless given. */
  card?: (feature: Site) => ReactNode;
}

interface ChoosingProps {
  heading?: (n: number) => ReactNode;
  intro?: ReactNode;
  row?: (feature: Site) => ReactNode;
  marker?: (feature: Site) => ReactNode;
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
 * Before a card, a pin that holds several sites opens the box on a list of them instead,
 * with no small map: a heading, which names the dialog, then one row per site, as the
 * app's list draws them. Picking one opens its card, with the stepper. Each card still
 * holds one record; the list is a step before the cards, not part of one.
 *
 * useSiteCard.ts opens and closes it (showModal / close) and owns what is selected; this
 * file is only its markup. `group` is every record at the selected one's location. The
 * card's content is `card`'s, or the block's own Card.
 */
export function SiteDialog(
  {
    ref, miniMapElement, feature, group, choices = [], onChoose, choosing = {}, model,
    origin = null, onStep, onClose, card,
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
    if (e.target === e.currentTarget) onClose();
  };

  const choosingNow = choices.length > 0;
  const describedBy = group.length > 1 ? "step-count"
    : choosingNow && choosing.intro ? "choices-intro" : undefined;

  return (
    <dialog className="site-dialog" id="site-dialog" aria-labelledby="card-title"
            aria-describedby={describedBy} ref={ref}
            onCancel={onCancel} onClick={onBackdropClick}>
      <Stepper group={group} currentId={feature && feature.properties.id} onStep={onStep} />
      <div className={choosingNow ? "card-box choosing" : "card-box"}>
        <div className="mini-map" id="mini-map" ref={miniMapElement} hidden={choosingNow} />
        {/* A plain box, not an <article>: inside the dialog, already named for the place,
            an article only made VoiceOver say the name again. */}
        <div className="card" id="card" hidden={!feature}>
          {feature && (card ? card(feature)
            : <Card feature={feature} model={model!} origin={origin} />)}
        </div>
        {choosingNow && <Choices sites={choices} onChoose={onChoose!} {...choosing} />}
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

/** The sites at one place, to choose one from: the heading the dialog is named by (its
 *  `card-title`, as a card's name is), the app's line under it, and a row for each. */
function Choices({ sites, onChoose, heading, intro, row, marker }: ChoosingProps & {
  sites: Site[]; onChoose: (feature: Site) => void;
}) {
  return (
    <div className="choices">
      <div className="choices-head">
        <h2 id="card-title" tabIndex={-1}>
          {heading ? heading(sites.length)
            : <span>{plural(sites.length, "{n} site", "{n} sites")}</span>}
        </h2>
        {intro && <p id="choices-intro">{intro}</p>}
      </div>
      <ul className="site-list">
        {sites.map((feature) => (
          <li key={feature.properties.id}>
            <SiteRow feature={feature} row={row} marker={marker}
                     onClick={() => onChoose(feature)} />
          </li>
        ))}
      </ul>
    </div>
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
