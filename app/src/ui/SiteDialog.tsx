import type { MouseEvent, Ref, SyntheticEvent } from "react";
import type { Model, Site } from "../logic/types.ts";
import { Card } from "./Card.tsx";

/** Which stepper arrow was pressed: towards the previous record in the group, or the next. */
export type StepDirection = "prev" | "next";

interface SiteDialogProps {
  ref: Ref<HTMLDialogElement>;
  /** The div the card's small map is drawn into. */
  miniMapRef: Ref<HTMLDivElement>;
  feature: Site | null;
  group: Site[];
  model: Model | null;
  lang: string;
  onStep: (delta: number, dir: StepDirection) => void;
  onClose: () => void;
}

/**
 * One site's card, as a modal: the same behaviour at every width. It opens centred
 * over a blurred map on a desktop and fills the frame on a phone, so there is one
 * layout to build and test, and nothing on the map moves to make room for it.
 *
 * A native <dialog> opened with showModal() makes everything behind it inert, keeps
 * Tab inside it, and turns Escape into a `cancel` event — the modal contract, from the
 * browser rather than from code. It holds a small map of the place, the stepper (chrome
 * for moving between records that share a location) and the card (always exactly one
 * record). The stepper and the card are siblings, so the card's content is never mixed
 * with the controls around it. Close is last in the DOM so Tab walks the card first.
 *
 * App.tsx opens and closes it (showModal / close) and owns what is selected; this file is
 * only its markup. `group` is every record at the selected one's location.
 */
export function SiteDialog(
  { ref, miniMapRef, feature, group, model, lang, onStep, onClose }: SiteDialogProps,
) {
  // Escape arrives as `cancel`. Taken over so it closes through history like every other
  // way of closing the card.
  const onCancel = (e: SyntheticEvent<HTMLDialogElement>) => {
    e.preventDefault();
    onClose();
  };
  // The dialog's children fill it, so a click that lands on the dialog element itself is
  // a click on the backdrop around it.
  const onBackdropClick = (e: MouseEvent<HTMLDialogElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <dialog className="site-dialog" id="site-dialog" aria-labelledby="card-title" ref={ref}
            onCancel={onCancel} onClick={onBackdropClick}>
      <div className="mini-map" id="mini-map" ref={miniMapRef} />
      <Stepper group={group} currentId={feature && feature.properties.id} onStep={onStep} />
      <article className="card" id="card" aria-labelledby="card-title" hidden={!feature}>
        {feature && <Card feature={feature} model={model!} lang={lang} />}
      </article>
      <button className="card-close" id="card-close" type="button" onClick={onClose}>
        <span aria-hidden="true">×</span>{" "}
        <span className="visually-hidden">Close this site</span>
      </button>
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
  return (
    <div className="stepper" id="stepper" role="group" hidden={!show}>
      {show && (
        <>
          <ArrowButton dir="prev" glyph={"‹"} label="Previous site at this location"
                       onClick={() => onStep(-1, "prev")} />
          {/* Separate text nodes, never "1 of 2" as one string: the proxy translates the
              words and leaves the numerals alone. */}
          <p className="step-count">
            <span>{index + 1}</span>{" "}<span>of</span>{" "}<span>{group.length}</span>{" "}
            <span>at this location</span>
          </p>
          <ArrowButton dir="next" glyph={"›"} label="Next site at this location"
                       onClick={() => onStep(1, "next")} />
        </>
      )}
    </div>
  );
}

/** One stepper arrow. The glyph is decoration; the label is what is announced. */
interface ArrowButtonProps {
  dir: StepDirection;
  glyph: string;
  label: string;
  onClick: () => void;
}

function ArrowButton({ dir, glyph, label, onClick }: ArrowButtonProps) {
  return (
    <button type="button" className={`step step-${dir}`} onClick={onClick}>
      <span aria-hidden="true">{glyph}</span>
      <span className="visually-hidden">{label}</span>
    </button>
  );
}
