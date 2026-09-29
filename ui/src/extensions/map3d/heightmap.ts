/**
 * Finds a terrain-RGB heightmap for a world. Elevation data is generated
 * locally via the Map Manager, even for worlds whose basemap imagery comes
 * from a CDN tier, so both the tile base and the local maps folder are
 * probed. Kept here (not in apiClient) so the 3D view touches no upstream code.
 *
 * @returns absolute URL of the first heightmap.pmtiles that exists, or null.
 */
export async function resolveHeightmapUrl(
  worldName: string,
  tileBaseAbs: string | null,
  absBase: string,
): Promise<string | null> {
  const candidates = [
    tileBaseAbs ? `${tileBaseAbs}/tiles/heightmap.pmtiles` : null,
    `${absBase}images/maps/${encodeURIComponent(worldName.toLowerCase())}/tiles/heightmap.pmtiles`,
  ].filter((u, i, all): u is string => u !== null && all.indexOf(u) === i);

  for (const url of candidates) {
    try {
      const res = await fetch(url, { method: "HEAD", cache: "no-store" });
      if (res.ok) return url;
    } catch {
      // Unreachable — try the next candidate
    }
  }
  return null;
}
