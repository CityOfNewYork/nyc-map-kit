import { t } from "../../logic/i18n.ts";

/**
 * The notice at the top of the list that a Code Blue is in effect. Shown always for now:
 * nothing yet says when one is.
 */
export function CodeBlueNotice() {
  return (
    <div className="notice" role="note">
      <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22">
        <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M12 2v20M3.3 7l17.4 10M20.7 7 3.3 17" />
          <path d="M9.5 3.5 12 6l2.5-2.5M9.5 20.5 12 18l2.5 2.5" />
        </g>
      </svg>
      <p>
        <span>{t("Code Blue is in effect.")}</span>{" "}
        <span>{t("Warming centers are open to anyone who needs them.")}</span>{" "}
        <strong>{t("In an emergency, call 911.")}</strong>
      </p>
    </div>
  );
}
