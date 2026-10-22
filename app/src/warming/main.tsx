import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { basemapId } from "../core/basemaps/names.ts";
import { chooseLanguage, loadLanguage, number, t, translateMarked } from "../logic/i18n.ts";
import App from "./App.tsx";
import { datasetFromUrl, DEFAULT_DATASET } from "./logic/dataset.ts";
import { wireNoteClose } from "../ui/note.ts";
// After App, which brings MapLibre's stylesheet; the kit's base styles, then warming's own.
import "../style.css";
import "./warming.css";

const params = new URLSearchParams(window.location.search);
// The interface's language, from ?lang= (see logic/i18n.ts). The basemap's labels stay
// English in every language, so the map is the same whichever is chosen.
const language = chooseLanguage(window.location.search, document.referrer);
const lang = "en";
// The default basemap unless ?basemap= names another (see core/basemaps/names.ts).
const basemap = basemapId(params.get("basemap"));
// A center's card opens as a panel beside the list, or as a pop-up with ?detail=popup.
const panel = params.get("detail") !== "popup";
await loadLanguage(language);
translateMarked();

// The note's ×.
wireNoteClose();

// The note's switches load the page again with one setting changed, keeping the rest of
// its address: the view, the open card and the filters. The page that loads puts focus
// back on the button, now pressed, so a keyboard or screen-reader user is where they were
// rather than at the top of the page, and says what changed.
const SWITCHED = "mapkit-note-switch";
const switched = takeFlag(SWITCHED);   // the parameter of the switch just used
// Which way a center's card opens.
wireSwitch("detail", panel ? "side" : "popup", "side", (value) => (value === "side"
  ? t("Detail cards now open in the sidebar.")
  : t("Detail cards now open in a pop-up.")));
// How many sample centers the map loads, with the numbers written the language's way.
for (const button of document.querySelectorAll<HTMLButtonElement>(
  '[data-param="dataset"] button')) {
  button.textContent = number(Number(button.dataset.value));
}
wireSwitch("dataset", datasetFromUrl(window.location.search), DEFAULT_DATASET,
  (value) => `${t("Sample size:")} ${number(Number(value))}`);

/** The note's switch for ?`param`: its buttons, one per value, with `current` pressed.
 *  `fallback` is the value the page takes with no parameter. `said` is what the page says
 *  once it has loaded again with a value. */
function wireSwitch(
  param: string, current: string, fallback: string, said: (value: string) => string,
) {
  const buttons = document.querySelectorAll<HTMLButtonElement>(`[data-param="${param}"] button`);
  for (const button of buttons) {
    const value = button.dataset.value!;
    const pressed = value === current;
    button.setAttribute("aria-pressed", String(pressed));
    if (pressed && switched === param) button.focus();
    button.addEventListener("click", () => {
      if (pressed) return;
      const url = new URL(window.location.href);
      if (value === fallback) url.searchParams.delete(param);
      else url.searchParams.set(param, value);
      setFlag(SWITCHED, param);
      window.location.replace(url);
    });
  }
  // After a pause, so it follows the screen reader's reading of the page and the button.
  if (switched === param) {
    setTimeout(() => {
      const status = document.getElementById("note-status");
      if (status) status.textContent = said(current);
    }, 1000);
  }
}

/** A flag for the next page load in this tab. sessionStorage can be blocked (a sandboxed
 *  frame, say); then focus starts at the top of the page as it did before. */
function setFlag(key: string, value: string) {
  try { sessionStorage.setItem(key, value); } catch { /* blocked */ }
}
function takeFlag(key: string): string | null {
  try {
    const value = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    return value;
  } catch {
    return null;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App lang={lang} basemap={basemap} panel={panel} />
  </StrictMode>,
);
