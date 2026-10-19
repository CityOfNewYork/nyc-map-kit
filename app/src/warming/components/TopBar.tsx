import { useState } from "react";
import { t } from "../../logic/i18n.ts";
import { LanguageMenu } from "./LanguageMenu.tsx";

/** The NYC logo, without the registration mark as the design system has it at this size
 *  (designsystem.nyc.gov/brand/logo.html). NYC is a trademark and service mark of the
 *  City of New York. */
const NYC_LOGO = "M430.8,60.7l9.2-8.6v-26.1L412.5,0h-91.6l-27.5,26.1V8.7L284.2,0h-36.7l-9.2,8.7v17.4l-18.3,17.4-18.3-17.4V8.7L192.5,0h-36.7l-9.2,8.7L137.5,0h-36.7l-9.2,8.7v34.8L45.8,0H9.2L0,8.7v121.6l9.2,8.7h36.7l9.2-8.7v-34.7l45.8,43.4h36.7l9.2-8.7V60.8l45.8,43.4v26.1l9.2,8.7h36.6l9.2-8.7v-26.1l45.8-43.4v52.1l27.5,26.1h91.6l27.5-26.1v-26.1l-9.2-8.7h-45.9v8.7h-36.6v-34.8h36.6v8.6h45.9Z";

/**
 * The bar across the top of the page: the NYC logo followed by "Warming Centers", the
 * page's heading, "Official website", which opens the line every nyc.gov page carries to
 * say it is the City's, and at the far end the language menu.
 */
export function TopBar() {
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <div className="header-bar">
        <h1>
          <svg className="nyc-logo" aria-hidden="true" viewBox="0 0 440 139">
            <path d={NYC_LOGO} fill="currentColor" />
          </svg>
          <span className="visually-hidden">NYC</span>{" "}
          <span className="site-title">{t("Warming Centers")}</span>
        </h1>
        <button type="button" className="official-toggle" aria-expanded={open}
                aria-controls="official-notice" onClick={() => setOpen((o) => !o)}>
          <span>{t("Official website")}</span>
          <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14">
            <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <LanguageMenu />
      </div>
      <div className="official-notice" id="official-notice" hidden={!open}>
        <p>
          <strong>{t("Official websites use nyc.gov.")}</strong>{" "}
          <span>{t("An nyc.gov website belongs to an official New York City government organization.")}</span>
        </p>
      </div>
    </header>
  );
}
