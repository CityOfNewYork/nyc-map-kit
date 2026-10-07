import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { resolveLang } from "./core/basemap-style.ts";
import { readSettings } from "./logic/params.ts";
import App from "./ui/App.tsx";
// After the components, which bring map-core and with it MapLibre's stylesheet, so these
// rules win where the two overlap.
import "./style.css";

const params = readSettings(window.location.search, document.baseURI, window.location.origin);
const settings = { ...params, lang: resolveLang(params.lang) };

// The proxy reads <html lang> to decide what it is translating from, and
// basemap-style.ts reads it to pick the basemap's label language.
document.documentElement.lang = settings.lang;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App settings={settings} />
  </StrictMode>,
);
