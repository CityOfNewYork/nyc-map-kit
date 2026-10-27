import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { basemapId } from "../core/basemaps/names.ts";
import { chooseLanguage, loadLanguage, translateMarked } from "../logic/i18n.ts";
import App from "./App.tsx";
import { sideCardFromUrl } from "./logic/view.ts";
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
// A center's card opens as a pop-up, or as a panel beside the list with ?detail=sidecard.
const panel = sideCardFromUrl(window.location.search);
await loadLanguage(language);
translateMarked();

// The note's ×.
wireNoteClose();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App lang={lang} basemap={basemap} panel={panel} />
  </StrictMode>,
);
