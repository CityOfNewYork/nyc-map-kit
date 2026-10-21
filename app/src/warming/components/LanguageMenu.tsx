import { useEffect, useId, useRef, useState } from "react";
import type { FocusEvent, KeyboardEvent, MouseEvent } from "react";
import { language, LANGUAGES, loadLanguage, t, translateMarked } from "../../logic/i18n.ts";

/** The translate symbol nyc.gov's header draws on its language button. */
const TRANSLATE_ICON = "m14.417 7.335 3.667 9.166h-1.796l-1.001-2.5h-3.408l-1 2.5H9.085l3.666-9.166zM7.334.668v1.667h5V4h-1.64a15.2 15.2 0 0 1-3.017 5.251c.6.536 1.253 1.013 1.946 1.423l-.625 1.565A14.2 14.2 0 0 1 6.5 10.439a13.9 13.9 0 0 1-5.167 2.957l-.447-1.608a12.25 12.25 0 0 0 4.44-2.535 15 15 0 0 1-2.353-3.585h1.866A13.4 13.4 0 0 0 6.5 8.065a13.5 13.5 0 0 0 2.425-4.063H.667V2.334h5V.668zm6.25 9.07-1.04 2.597h2.077z";

/** This page's address in `code`, keeping the rest of it: the view, the card, the filters. */
function addressIn(code: string): string {
  const url = new URL(window.location.href);
  if (code === "en") url.searchParams.delete("lang");
  else url.searchParams.set("lang", code);
  return url.href;
}

/**
 * The language the page is in, at the end of the top bar, and a list of the others, each
 * in its own language, as nyc.gov's header offers them. Choosing one changes the page's
 * words in place, and its address, so the map, the card and the filters stay as they
 * are. Escape or a click elsewhere closes the list; Escape puts focus back on the button.
 */
export function LanguageMenu() {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const current = LANGUAGES.find((l) => l.code === language()) ?? LANGUAGES[0];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Tab out of the list closes it, so it does not cover what focus moves on to. A focus
  // that goes nowhere, as a click on the page does, is left to the pointerdown above.
  function onBlur(e: FocusEvent<HTMLDivElement>) {
    const next = e.relatedTarget as Node | null;
    if (open && next && !root.current?.contains(next)) setOpen(false);
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (open && e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      button.current?.focus();
    }
  }
  // The address is read at the click, not the render: the page changes its own address
  // as the reader opens cards and sets filters.
  async function choose(e: MouseEvent<HTMLAnchorElement>, code: string) {
    e.preventDefault();
    setOpen(false);
    history.replaceState(history.state, "", addressIn(code));
    await loadLanguage(code);
    translateMarked();
    button.current?.focus();
  }

  return (
    <div className="language-menu" ref={root} onKeyDown={onKeyDown} onBlur={onBlur}>
      <button type="button" className="language-toggle" ref={button} aria-expanded={open}
              aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <svg aria-hidden="true" viewBox="0 0 19 17" width="19" height="17">
          <path fill="currentColor" d={TRANSLATE_ICON} />
        </svg>
        <span className="visually-hidden">{t("Language")}</span>
        <span className="language-current" lang={current.code}>{current.name}</span>
      </button>
      <ul className="language-list" id={id} hidden={!open}>
        {LANGUAGES.map((l) => (
          <li key={l.code}>
            <a href={addressIn(l.code)} lang={l.code} hrefLang={l.code}
               aria-current={l.code === current.code ? "true" : undefined}
               onClick={(e) => void choose(e, l.code)}>
              {l.name}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
