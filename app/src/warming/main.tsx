import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { basemapId } from "../core/basemaps/names.ts";
import { chooseLanguage, loadLanguage, t, translateMarked } from "../logic/i18n.ts";
import App from "./App.tsx";
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

// The note's Sidebar and Pop-up buttons load the page again with the card the other way,
// keeping the rest of its address: the view, the open card and the filters. The page
// that loads puts focus back on the button, now pressed, so a keyboard or screen-reader
// user is where they were rather than at the top of the page, and says what changed.
const FOCUS_CARD_MODE = "mapkit-focus-card-mode";
const switched = takeFlag(FOCUS_CARD_MODE);
for (const button of document.querySelectorAll<HTMLButtonElement>(".card-mode [data-detail]")) {
  const side = button.dataset.detail === "side";
  button.setAttribute("aria-pressed", String(side === panel));
  if (side === panel && switched) button.focus();
  button.addEventListener("click", () => {
    if (side === panel) return;
    const url = new URL(window.location.href);
    if (side) url.searchParams.delete("detail");
    else url.searchParams.set("detail", "popup");
    setFlag(FOCUS_CARD_MODE);
    window.location.replace(url);
  });
}
// After a pause, so it follows the screen reader's reading of the page and the button.
if (switched) {
  setTimeout(() => {
    const status = document.getElementById("card-mode-status");
    if (status) {
      status.textContent = panel
        ? t("Detail cards now open in the sidebar.")
        : t("Detail cards now open in a pop-up.");
    }
  }, 1000);
}

/** A flag for the next page load in this tab. sessionStorage can be blocked (a sandboxed
 *  frame, say); then focus starts at the top of the page as it did before. */
function setFlag(key: string) {
  try { sessionStorage.setItem(key, "1"); } catch { /* blocked */ }
}
function takeFlag(key: string): boolean {
  try {
    const set = sessionStorage.getItem(key) !== null;
    sessionStorage.removeItem(key);
    return set;
  } catch {
    return false;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App lang={lang} basemap={basemap} panel={panel} />
  </StrictMode>,
);
