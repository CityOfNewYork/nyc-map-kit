import { useCallback, useMemo, useRef } from "react";
import { createMap } from "../core/map-core.js";

/**
 * A map-core map inside a <div> that React renders but never fills.
 *
 * React owns the element; map-core and MapLibre own everything inside it. So the map is
 * created and destroyed imperatively, from an effect or an event, rather than rendered,
 * and the div is given no React children while the map is in it.
 *
 *   const main = useMapCore();
 *   <div ref={main.containerRef} />
 *   main.create({ style, data, onSelect });   // once the div is in the page
 *   main.mapRef.current.select(id);           // map-core's API, unchanged
 *   main.destroy();
 */
export function useMapCore() {
  const containerRef = useRef(null);
  const mapRef = useRef(null);

  const create = useCallback((options) => {
    mapRef.current = createMap(containerRef.current, options);
    return mapRef.current;
  }, []);

  const destroy = useCallback(() => {
    if (mapRef.current) mapRef.current.destroy();
    mapRef.current = null;
  }, []);

  // The same object on every render, so effects can depend on it without re-running.
  return useMemo(() => ({ containerRef, mapRef, create, destroy }), [create, destroy]);
}
