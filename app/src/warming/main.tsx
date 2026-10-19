import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { resolveLang } from "../core/basemap-style.ts";
import { basemapId } from "../core/basemaps/names.ts";
import App from "./App.tsx";
// After App, which brings MapLibre's stylesheet; the kit's base styles, then warming's own.
import "../style.css";
import "./warming.css";

const params = new URLSearchParams(window.location.search);
const lang = resolveLang(params.get("lang"));
// The default basemap unless ?basemap= names another (see core/basemaps/names.ts).
const basemap = basemapId(params.get("basemap"));
// A center's card opens as a panel beside the list, or as a pop-up with ?detail=popup.
const panel = params.get("detail") !== "popup";
document.documentElement.lang = lang;

// The note's Sidebar and Pop-up buttons load the page again with the card the other way,
// keeping the rest of its address: the view, the open card and the filters.
for (const button of document.querySelectorAll<HTMLButtonElement>(".card-mode [data-detail]")) {
  const side = button.dataset.detail === "side";
  button.setAttribute("aria-pressed", String(side === panel));
  button.addEventListener("click", () => {
    if (side === panel) return;
    const url = new URL(window.location.href);
    if (side) url.searchParams.delete("detail");
    else url.searchParams.set("detail", "popup");
    window.location.replace(url);
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App lang={lang} basemap={basemap} panel={panel} />
  </StrictMode>,
);
