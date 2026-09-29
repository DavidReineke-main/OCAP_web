/**
 * 3D map view — fork extension entry point.
 *
 * Everything for the 3D view lives in this folder. Upstream code only has
 * two hook points (see README.md), so merging upstream stays conflict-free.
 */
import type { MapRenderer } from "../../renderers/renderer.interface";
import { MapLibre3DRenderer } from "./maplibre3dRenderer";
import { is3DRequested } from "./mode";
import "./i18n";

export { Map3DToggle } from "./Map3DToggle";

/** The 3D renderer when requested via URL, otherwise null (use the default renderer). */
export function create3DRendererIfRequested(): MapRenderer | null {
  return is3DRequested() ? new MapLibre3DRenderer() : null;
}
