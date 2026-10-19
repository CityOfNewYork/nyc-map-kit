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
// A center's card opens as a panel beside the list with ?detail=side, else as a pop-up.
const panel = params.get("detail") === "side";
document.documentElement.lang = lang;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App lang={lang} basemap={basemap} panel={panel} />
  </StrictMode>,
);
