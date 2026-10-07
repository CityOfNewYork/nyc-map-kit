import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { resolveLang } from "./core/basemap-style.js";
import { readSettings } from "./logic/params.js";
import App from "./ui/App.jsx";
// After the components, which bring map-core and with it MapLibre's stylesheet, so these
// rules win where the two overlap.
import "./style.css";

const settings = readSettings(window.location.search, document.baseURI, window.location.origin);
settings.lang = resolveLang(settings.lang);

// The proxy reads <html lang> to decide what it is translating from, and
// basemap-style.js reads it to pick the basemap's label language.
document.documentElement.lang = settings.lang;

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App settings={settings} />
  </StrictMode>,
);
