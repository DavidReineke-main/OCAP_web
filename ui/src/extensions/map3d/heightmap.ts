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

// --------------- Terrain tiles without the no-data pit ---------------

/**
 * Heightmap tiles are transparent (0,0,0,0) outside the world. Terrain-RGB
 * decodes that as -10000 m, so the terrain dropped into a 10 km pit around
 * the map. This protocol serves the same tiles with those pixels set to sea
 * level instead.
 */
export const DEM_PROTOCOL = "ocapdem";

/** Terrain-RGB encoding of 0 m: (0 + 10000) / 0.1 = 100000 = 0x0186A0. */
const SEA_LEVEL_RGB = [0x01, 0x86, 0xa0] as const;

/** Sets fully transparent RGBA pixels to opaque sea level. Returns whether any changed. */
export function fillNoData(rgba: Uint8ClampedArray): boolean {
  let changed = false;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) {
      rgba[i] = SEA_LEVEL_RGB[0];
      rgba[i + 1] = SEA_LEVEL_RGB[1];
      rgba[i + 2] = SEA_LEVEL_RGB[2];
      rgba[i + 3] = 255;
      changed = true;
    }
  }
  return changed;
}

/** True for PNGs without an alpha channel (IHDR colour type 0 or 2), which need no patching. */
export function isOpaquePng(data: ArrayBuffer): boolean {
  const bytes = new Uint8Array(data);
  return bytes.length > 25 && (bytes[25] === 0 || bytes[25] === 2);
}

async function patchTile(data: ArrayBuffer): Promise<ArrayBuffer> {
  if (isOpaquePng(data)) return data;
  const bmp = await createImageBitmap(new Blob([data], { type: "image/png" }));
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  if (!fillNoData(img.data)) return data;
  ctx.putImageData(img, 0, 0);
  return (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer();
}

const archives = new Map<string, Promise<any>>();

function archive(url: string): Promise<any> {
  let a = archives.get(url);
  if (!a) {
    a = import("pmtiles").then(({ PMTiles }) => new PMTiles(url));
    archives.set(url, a);
  }
  return a;
}

let demRegistered = false;

/** Registers the ocapdem:// protocol with MapLibre once per page. */
export function registerDemProtocol(maplibregl: { addProtocol: (name: string, fn: any) => void }): void {
  if (demRegistered) return;
  demRegistered = true;
  maplibregl.addProtocol(DEM_PROTOCOL, async (params: { url: string }, abort: AbortController) => {
    const m = new RegExp(`^${DEM_PROTOCOL}://(\\d+)/(\\d+)/(\\d+)\\?url=(.*)$`).exec(params.url);
    if (!m) throw new Error(`Bad terrain tile URL: ${params.url}`);
    const tile = await (await archive(decodeURIComponent(m[4]))).getZxy(+m[1], +m[2], +m[3], abort.signal);
    // A missing tile is simply no terrain there; MapLibre treats empty data as such.
    return { data: tile ? await patchTile(tile.data) : new ArrayBuffer(0) };
  });
}

/** MapLibre raster-dem source for a heightmap.pmtiles, served through ocapdem://. */
export async function demSource(heightmapUrl: string): Promise<Record<string, unknown>> {
  const header = await (await archive(heightmapUrl)).getHeader();
  return {
    type: "raster-dem",
    tiles: [`${DEM_PROTOCOL}://{z}/{x}/{y}?url=${encodeURIComponent(heightmapUrl)}`],
    tileSize: 256,
    encoding: "mapbox",
    minzoom: header.minZoom,
    maxzoom: header.maxZoom,
    bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat],
  };
}
