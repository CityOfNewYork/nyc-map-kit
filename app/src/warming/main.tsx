import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { resolveLang } from "../core/basemap-style.ts";
import App from "./App.tsx";
// After App, which brings MapLibre's stylesheet; the kit's base styles, then warming's own.
import "../style.css";
import "./warming.css";

const lang = resolveLang(new URLSearchParams(window.location.search).get("lang"));
document.documentElement.lang = lang;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App lang={lang} />
  </StrictMode>,
);
