import { describe, it, expect } from "vitest";
import { METERS_PER_DEGREE } from "../../../utils/coordinates";
import {
  legacyTileUrl,
  parseLegacyTileUrl,
  mercatorTileToImageRect,
  pickLegacyZoom,
  legacyStyles,
} from "../legacyRaster";

const cfg = { base: "http://host/images/maps/archie/topoRelief", imageSize: 12288, multiplier: 1, maxZoom: 6 };

describe("legacyTileUrl / parseLegacyTileUrl", () => {
  it("round-trips a concrete tile request", () => {
    const url = legacyTileUrl(cfg).replace("{z}", "15").replace("{x}", "16384").replace("{y}", "16380");
    expect(parseLegacyTileUrl(url)).toEqual({ z: 15, x: 16384, y: 16380, cfg });
  });

  it("rejects foreign URLs", () => {
    expect(parseLegacyTileUrl("https://example.com/1/2/3.png")).toBeNull();
  });
});

describe("mercatorTileToImageRect", () => {
  it("maps the tile at the world origin to the bottom-left of the image", () => {
    // Zoom 15 tile whose south-west corner is lng/lat 0/0 (Arma 0/0).
    const rect = mercatorTileToImageRect(15, 16384, 16383, cfg);
    const tileMetres = (360 / 2 ** 15) * METERS_PER_DEGREE;
    expect(rect.left).toBeCloseTo(0, 6);
    expect(rect.right).toBeCloseTo(tileMetres, 3);
    expect(rect.bottom).toBeCloseTo(12288, 3);
    // Mercator is near-linear this close to the equator.
    expect(rect.bottom - rect.top).toBeCloseTo(tileMetres, 0);
  });

  it("applies the multiplier to image pixels", () => {
    const rect = mercatorTileToImageRect(15, 16384, 16383, { imageSize: 8192, multiplier: 2 });
    expect(rect.right).toBeCloseTo((360 / 2 ** 15) * METERS_PER_DEGREE * 2, 3);
  });
});

describe("pickLegacyZoom", () => {
  it("uses the native level at or below 1 image px per tile px", () => {
    expect(pickLegacyZoom(0.5, 6)).toBe(6);
    expect(pickLegacyZoom(1, 6)).toBe(6);
  });

  it("steps down one level per halving of resolution, never below 0", () => {
    expect(pickLegacyZoom(2, 6)).toBe(5);
    expect(pickLegacyZoom(5, 6)).toBe(4);
    expect(pickLegacyZoom(1e6, 6)).toBe(0);
  });
});

describe("legacyStyles", () => {
  it("lists the tile sets a world offers, topo first like the 2D renderer", () => {
    expect(legacyStyles({ hasTopoDark: true, hasTopoRelief: true, hasColorRelief: true }).map((s) => s.path)).toEqual([
      "",
      "topoDark",
      "topoRelief",
      "colorRelief",
    ]);
  });

  it("omits topo when a world says it has none", () => {
    expect(legacyStyles({ hasTopo: false, hasColorRelief: true }).map((s) => s.path)).toEqual(["colorRelief"]);
  });
});
