/**
 * Small records and stubs for tests: a site, the model an app holds for a set of them, and
 * a screen of a given width.
 */
import { vi } from "vitest";
import { prepareData } from "../logic/data.ts";
import type { Config, Model, OrgsDoc, Site, SiteCollection, SiteProperties } from "../logic/types.ts";

/** A site with `properties` over a plain default, at `coordinates`. */
export function site(
  id: string, properties: Partial<SiteProperties> & Record<string, unknown> = {},
  coordinates: [number, number] = [-73.95, 40.75],
): Site {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates },
    properties: { id, org: `Org ${id}`, org_id: id, address: `${id} Main Street`, ...properties },
  };
}

/** The model an app builds from `config`, the sites and orgs.json, as App does. */
export function model(
  config: Config, features: Site[], orgs: OrgsDoc | null = null, generated?: string,
): Model {
  const data: SiteCollection = { type: "FeatureCollection", features, generated };
  return { config, data, ...prepareData(config, data, orgs) };
}

/** A screen that is wide enough for the list panel (768 px), or not, and can be resized,
 *  and that does or does not ask for reduced motion. Neither Node nor jsdom has matchMedia;
 *  undo with vi.unstubAllGlobals(). */
export function stubScreen(desktop: boolean, reducedMotion = false) {
  const listeners = new Set<() => void>();
  const screen = {
    matches: desktop,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    resize(toDesktop: boolean) {
      screen.matches = toDesktop;
      for (const listener of listeners) listener();
    },
  };
  const motion = { matches: reducedMotion, addEventListener() {}, removeEventListener() {} };
  vi.stubGlobal("matchMedia", (query: string) => (query.includes("min-width") ? screen : motion));
  return screen;
}
