import { resolve } from "node:path";
import { defineConfig } from "vite";

// The app lives in app/ and builds to dist/app/, so the published address keeps its shape:
// <site>/app/demo.html and <site>/app/embed.html, the same as when GitHub Pages served the
// source directly.
//
// `base: "./"` makes every built URL relative. The block has to work at localhost, under
// the GitHub Pages subpath, and wherever a city host puts it, without a rebuild per host.
//
// app/public/ holds the files the app fetches at runtime by name: config.json, the data
// files and the fonts. They are copied as-is, unhashed, so `?data=one-site.geojson` and a
// swapped-in config.json keep working without touching the build.
export default defineConfig({
  root: "app",
  base: "./",
  build: {
    outDir: "../dist/app",
    emptyOutDir: true,
    // MapLibre alone is ~1 MB minified (~270 KB gzipped) and is the bulk of the bundle;
    // the warning's default 500 KB threshold would fire on every build without saying
    // anything new.
    chunkSizeWarningLimit: 1200,
    rolldownOptions: {
      input: {
        demo: resolve(import.meta.dirname, "app/demo.html"),
        embed: resolve(import.meta.dirname, "app/embed.html"),
      },
    },
  },
});
