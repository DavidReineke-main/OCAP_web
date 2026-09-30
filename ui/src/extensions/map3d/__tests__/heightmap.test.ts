import { describe, it, expect, vi, afterEach } from "vitest";
import { fillNoData, isOpaquePng, resolveHeightmapUrl } from "../heightmap";

describe("resolveHeightmapUrl", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(existing: string[]) {
    const fetchMock = vi.fn(async (url: string) => ({ ok: existing.includes(url) }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("prefers the heightmap next to the world's tiles", async () => {
    stubFetch(["https://cdn.example/altis/tiles/heightmap.pmtiles", "http://host/images/maps/altis/tiles/heightmap.pmtiles"]);
    await expect(resolveHeightmapUrl("Altis", "https://cdn.example/altis", "http://host/"))
      .resolves.toBe("https://cdn.example/altis/tiles/heightmap.pmtiles");
  });

  it("falls back to a locally generated heightmap for CDN-hosted worlds", async () => {
    stubFetch(["http://host/images/maps/altis/tiles/heightmap.pmtiles"]);
    await expect(resolveHeightmapUrl("Altis", "https://cdn.example/altis", "http://host/"))
      .resolves.toBe("http://host/images/maps/altis/tiles/heightmap.pmtiles");
  });

  it("probes the local path only once when it is also the tile base", async () => {
    const fetchMock = stubFetch([]);
    await expect(resolveHeightmapUrl("altis", "http://host/images/maps/altis", "http://host/")).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    await expect(resolveHeightmapUrl("altis", null, "http://host/")).resolves.toBeNull();
  });
});

describe("fillNoData", () => {
  it("turns transparent no-data pixels into sea level (0 m in Terrain-RGB)", () => {
    const px = new Uint8ClampedArray([0, 0, 0, 0, 10, 20, 30, 255]);
    expect(fillNoData(px)).toBe(true);
    const [r, g, b, a] = px;
    expect(-10000 + (r * 65536 + g * 256 + b) * 0.1).toBeCloseTo(0, 6);
    expect(a).toBe(255);
    expect([...px.slice(4)]).toEqual([10, 20, 30, 255]);
  });

  it("reports when a tile had nothing to fill", () => {
    expect(fillNoData(new Uint8ClampedArray([1, 2, 3, 255]))).toBe(false);
  });
});

describe("isOpaquePng", () => {
  function pngWithColourType(type: number): ArrayBuffer {
    const bytes = new Uint8Array(33);
    bytes[25] = type; // IHDR colour type
    return bytes.buffer;
  }

  it("skips RGB and greyscale tiles", () => {
    expect(isOpaquePng(pngWithColourType(2))).toBe(true);
    expect(isOpaquePng(pngWithColourType(0))).toBe(true);
  });

  it("patches tiles with an alpha channel", () => {
    expect(isOpaquePng(pngWithColourType(6))).toBe(false);
  });
});
