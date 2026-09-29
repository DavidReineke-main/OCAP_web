import { describe, it, expect } from "vitest";
import { METERS_PER_DEGREE } from "../../../utils/coordinates";
import {
  armaToLngLat,
  lngLatToArma,
  clampPitch,
  resolveEntityIconKey,
  DEFAULT_3D_PITCH,
  MapLibre3DRenderer,
} from "../maplibre3dRenderer";

// The renderer's init() creates a real maplibregl.Map, which needs a WebGL
// canvas context jsdom doesn't provide — like LeafletRenderer, that path is
// excluded from unit test coverage (see vitest.config.ts) and exercised
// manually / via the app. These tests cover the pure, renderer-independent
// logic: coordinate conversion, camera math, and icon key resolution.

describe("armaToLngLat", () => {
  it("converts [0, 0] to [0, 0]", () => {
    expect(armaToLngLat([0, 0])).toEqual([0, 0]);
  });

  it("maps Arma X to lng and Arma Y to lat", () => {
    const [lng, lat] = armaToLngLat([5000, 10000]);
    expect(lng).toBeCloseTo(5000 / METERS_PER_DEGREE, 8);
    expect(lat).toBeCloseTo(10000 / METERS_PER_DEGREE, 8);
  });

  it("ignores the z coordinate", () => {
    const flat = armaToLngLat([5000, 10000]);
    const withZ = armaToLngLat([5000, 10000, 250]);
    expect(withZ).toEqual(flat);
  });

  it("round-trips through lngLatToArma", () => {
    const original: [number, number] = [15360, 8192];
    const [lng, lat] = armaToLngLat(original);
    const back = lngLatToArma({ lng, lat });
    expect(back[0]).toBeCloseTo(original[0], 5);
    expect(back[1]).toBeCloseTo(original[1], 5);
  });
});

describe("lngLatToArma", () => {
  it("converts LngLat(0, 0) to [0, 0]", () => {
    expect(lngLatToArma({ lng: 0, lat: 0 })).toEqual([0, 0]);
  });

  it("converts degrees back to meters", () => {
    const coord = lngLatToArma({ lng: 1, lat: 1 });
    expect(coord[0]).toBeCloseTo(METERS_PER_DEGREE, 5);
    expect(coord[1]).toBeCloseTo(METERS_PER_DEGREE, 5);
  });
});

describe("clampPitch", () => {
  it("passes through values within range", () => {
    expect(clampPitch(45)).toBe(45);
  });

  it("clamps negative pitch to 0", () => {
    expect(clampPitch(-10)).toBe(0);
  });

  it("clamps pitch above the plan's 85 degree max", () => {
    expect(clampPitch(120)).toBe(85);
  });

  it("allows exactly the boundary values", () => {
    expect(clampPitch(0)).toBe(0);
    expect(clampPitch(85)).toBe(85);
  });
});

describe("DEFAULT_3D_PITCH", () => {
  it("is within the allowed pitch range", () => {
    expect(DEFAULT_3D_PITCH).toBeGreaterThan(0);
    expect(DEFAULT_3D_PITCH).toBeLessThanOrEqual(85);
  });
});

describe("resolveEntityIconKey", () => {
  it("resolves a live side icon", () => {
    expect(resolveEntityIconKey("man", "WEST", 1, false)).toBe("man:blufor");
  });

  it("resolves the dead variant regardless of side", () => {
    expect(resolveEntityIconKey("tank", "EAST", 0, false)).toBe("tank:dead");
  });

  it("resolves the unconscious variant", () => {
    expect(resolveEntityIconKey("man", "GUER", 2, false)).toBe("man:unconscious");
  });

  it("resolves the hit flash icon when alive and hit", () => {
    expect(resolveEntityIconKey("heli", "WEST", 1, true)).toBe("heli:hit");
  });

  it("does not use the hit variant for a dead entity", () => {
    expect(resolveEntityIconKey("heli", "WEST", 0, true)).toBe("heli:dead");
  });

  it("falls back to dead for a null side while alive", () => {
    expect(resolveEntityIconKey("man", null, 1, false)).toBe("man:dead");
  });

  it("falls back to the unknown type for unrecognized icon types", () => {
    expect(resolveEntityIconKey("spaceship", "WEST", 1, false)).toBe("unknown:blufor");
  });
});

describe("MapLibre3DRenderer", () => {
  it("starts in 3D mode by default", () => {
    const renderer = new MapLibre3DRenderer();
    expect(renderer.is3DMode()).toBe(true);
  });

  it("has sane defaults before init() is called", () => {
    const renderer = new MapLibre3DRenderer();
    expect(renderer.getZoom()).toBe(0);
    expect(renderer.getCenter()).toEqual([0, 0]);
    expect(renderer.getPitch()).toBe(0);
    expect(renderer.getBearing()).toBe(0);
  });

  it("does not throw when disposed before init()", () => {
    const renderer = new MapLibre3DRenderer();
    expect(() => renderer.dispose()).not.toThrow();
  });
});
