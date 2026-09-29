import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveHeightmapUrl } from "../heightmap";

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
