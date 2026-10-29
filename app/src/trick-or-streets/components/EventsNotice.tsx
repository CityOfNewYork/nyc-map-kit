import { t } from "../../logic/i18n.ts";

/** The notice at the top of the list that an event can move or be called off, as DOT's own
 *  page says of every Trick-or-Streets event. */
export function EventsNotice() {
  return (
    <div className="notice" role="note">
      <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22">
        <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5.5" />
        </g>
        <circle cx="12" cy="7.6" r="1.3" fill="currentColor" />
      </svg>
      <p><span>{t("Events are subject to delay or cancellation.")}</span></p>
    </div>
  );
}
