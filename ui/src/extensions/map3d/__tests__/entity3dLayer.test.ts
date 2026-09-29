import { describe, it, expect } from "vitest";
import {
  Entity3DLayer,
  AIRBORNE_ICON_TYPES,
  transformPoint,
  lngLatAltToMercator,
  type AirborneEntityState,
} from "../entity3dLayer";

describe("lngLatAltToMercator", () => {
  it("matches MapLibre's documented MercatorCoordinate.fromLngLat(0,0,0) = (0.5, 0.5, 0)", () => {
    const m = lngLatAltToMercator(0, 0, 0);
    expect(m.x).toBeCloseTo(0.5, 10);
    expect(m.y).toBeCloseTo(0.5, 10);
    expect(m.z).toBeCloseTo(0, 10);
  });

  it("maps longitude linearly to x across the full [-180, 180] range", () => {
    expect(lngLatAltToMercator(-180, 0, 0).x).toBeCloseTo(0, 10);
    expect(lngLatAltToMercator(180, 0, 0).x).toBeCloseTo(1, 10);
  });

  it("increases z (mercator altitude) monotonically with altitude at a fixed latitude", () => {
    const low = lngLatAltToMercator(10, 10, 100);
    const high = lngLatAltToMercator(10, 10, 500);
    expect(high.z).toBeGreaterThan(low.z);
    // Linear in altitude at fixed lat/lon.
    expect(high.z / low.z).toBeCloseTo(5, 5);
  });

  it("scales the same altitude to a larger mercator z further from the equator", () => {
    // Web Mercator stretches horizontally near the poles (meters-per-mercator-unit
    // shrinks), so the same real-world altitude maps to a larger mercator z there.
    const atEquator = lngLatAltToMercator(0, 0, 200);
    const atHighLat = lngLatAltToMercator(0, 60, 200);
    expect(atHighLat.z).toBeGreaterThan(atEquator.z);
  });
});

describe("transformPoint", () => {
  const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

  it("leaves a point unchanged under the identity matrix (w=1)", () => {
    expect(transformPoint(IDENTITY, 1, 2, 3)).toEqual([1, 2, 3, 1]);
  });

  it("applies a uniform scale matrix", () => {
    const scale2x = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1];
    expect(transformPoint(scale2x, 1, 1, 1)).toEqual([2, 2, 2, 1]);
  });

  it("applies a translation matrix (column-major, translation in the last column)", () => {
    const translate = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1];
    expect(transformPoint(translate, 0, 0, 0)).toEqual([5, 6, 7, 1]);
  });
});

describe("AIRBORNE_ICON_TYPES", () => {
  it("includes aircraft and parachutes", () => {
    expect(AIRBORNE_ICON_TYPES.has("heli")).toBe(true);
    expect(AIRBORNE_ICON_TYPES.has("plane")).toBe(true);
    expect(AIRBORNE_ICON_TYPES.has("parachute")).toBe(true);
  });

  it("excludes ground types", () => {
    expect(AIRBORNE_ICON_TYPES.has("man")).toBe(false);
    expect(AIRBORNE_ICON_TYPES.has("car")).toBe(false);
    expect(AIRBORNE_ICON_TYPES.has("tank")).toBe(false);
  });
});

// jsdom has no real WebGL/canvas 2D context (HTMLCanvasElement.getContext
// returns null), so these only smoke-test that the DOM lifecycle methods
// don't throw when instrumented that way — not that anything actually draws.
// Real rendering is exercised manually / via the running app.
describe("Entity3DLayer lifecycle (smoke test under jsdom)", () => {
  function fakeMap() {
    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(container, "clientHeight", { value: 600, configurable: true });
    const listeners = new Map<string, () => void>();
    return {
      getCanvasContainer: () => container,
      on: (event: string, cb: () => void) => listeners.set(event, cb),
      off: (event: string) => listeners.delete(event),
      triggerRepaint: () => {},
    };
  }

  it("has the expected CustomLayerInterface shape", () => {
    const layer = new Entity3DLayer();
    expect(layer.id).toBe("entities-3d");
    expect(layer.type).toBe("custom");
    expect(layer.renderingMode).toBe("3d");
  });

  it("does not throw across onAdd -> setEntities -> render -> onRemove", () => {
    const layer = new Entity3DLayer();
    const map = fakeMap();
    expect(() => layer.onAdd(map)).not.toThrow();

    const entities: AirborneEntityState[] = [
      {
        id: 1,
        position: [1000, 2000, 300],
        direction: 45,
        iconType: "heli",
        side: "WEST",
        alive: 1,
        hit: false,
        name: "Pelican 1-1",
        showName: true,
        opacity: 1,
      },
    ];
    layer.setEntities(entities);

    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    expect(() =>
      layer.render({} as WebGLRenderingContext, { modelViewProjectionMatrix: identity }),
    ).not.toThrow();

    expect(() => layer.onRemove()).not.toThrow();
  });

  it("setEntities accepts an empty list", () => {
    const layer = new Entity3DLayer();
    expect(() => layer.setEntities([])).not.toThrow();
  });
});
