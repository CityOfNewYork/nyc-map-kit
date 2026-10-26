import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The app lives in app/ and builds to dist/app/. The map is <site>/app/ (index.html), the
// address a host page's iframe points at too; it shows the public computer centers, and
// <site>/app/computer-centers.html is the same page. <site>/app/snap.html is the same block
// on a second dataset, <site>/app/examples.html embeds that one at several sizes, and
// <site>/app/compare.html shows two basemaps side by side. <site>/app/wheelchair-friendly.html
// is the block on the City's wheelchair friendly restaurants.
//
// `base: "./"` makes every built URL relative. The block has to work at localhost, under
// the GitHub Pages subpath, and wherever a city host puts it, without a rebuild per host.
//
// app/public/ holds the files the app fetches at runtime by name: config.json, the data
// files and the fonts. They are copied as-is, unhashed, so `?data=one-site.geojson` and a
// swapped-in config.json keep working without touching the build.
export default defineConfig({
  plugins: [react()],
  test: {
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      reportsDirectory: "../coverage",

      include: [
        "src/**/*.{ts,tsx}"
      ],

      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/test/**",
        "src/main.tsx",
        "src/warming/main.tsx"
      ],

      // The pure logic may not fall below a little under what its tests reach, so new
      // logic there comes with tests. Components have no floor: a percentage says little
      // about what a reader can do with them.
      thresholds: {
        "src/logic/**": { statements: 95, branches: 85, functions: 95, lines: 95 },
        "src/warming/logic/**": { statements: 95, branches: 95, functions: 95, lines: 95 },
      }
    }
  },
  root: "app",
  base: "./",
  build: {
    outDir: "../dist/app",
    emptyOutDir: true,
    // MapLibre (~1 MB minified) and React (~0.2 MB) are most of the one bundle, ~345 KB
    // gzipped. The warning's default 500 KB threshold would fire on every build without
    // saying anything new; this one fires if the app's own code grows a lot.
    chunkSizeWarningLimit: 1400,
    rolldownOptions: {
      input: {
        index: resolve(import.meta.dirname, "app/index.html"),
        snap: resolve(import.meta.dirname, "app/snap.html"),
        examples: resolve(import.meta.dirname, "app/examples.html"),
        compare: resolve(import.meta.dirname, "app/compare.html"),
        warming: resolve(import.meta.dirname, "app/warming.html"),
        "computer-centers": resolve(import.meta.dirname, "app/computer-centers.html"),
        "wheelchair-friendly": resolve(import.meta.dirname, "app/wheelchair-friendly.html"),
      },
    },
  },
});
