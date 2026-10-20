import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { chooseLanguage, loadLanguage, translateMarked } from "./logic/i18n.ts";
import { readSettings } from "./logic/params.ts";
import App from "./ui/App.tsx";
// After the components, which bring map-core and with it MapLibre's stylesheet, so these
// rules win where the two overlap.
import "./style.css";

const params = readSettings(window.location.search, document.baseURI, window.location.origin);
// The interface's language: ?lang=, or in an embed the host page's (see logic/i18n.ts).
const language = chooseLanguage(window.location.search, document.referrer);
const settings = { ...params, lang: language };

await loadLanguage(language);
translateMarked();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App settings={settings} />
  </StrictMode>,
);
