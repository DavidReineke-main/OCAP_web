import { METERS_PER_DEGREE } from "../../utils/coordinates";

/**
 * Serves legacy raster maps (gdal2tiles output as used by the 2D Leaflet
 * renderer: `{base}/{z}/{x}/{y}.png`, y = 0 at the top, image pixel =
 * metres × multiplier at maxZoom) as Web Mercator tiles for MapLibre.
 *
 * The 3D renderer places Arma metres at lng/lat = metres / METERS_PER_DEGREE,
 * so every Mercator tile maps to a rectangle of the legacy image; this
 * composes it from the legacy tiles covering that rectangle. No new map
 * data is needed.
 */

export const LEGACY_PROTOCOL = "ocaplegacy";

export interface LegacyRasterConfig {
  /** Absolute URL of the tile set, e.g. "http://host/images/maps/archie/topoRelief". */
  base: string;
  imageSize: number;
  multiplier: number;
  maxZoom: number;
}

/** Tile URL template for a MapLibre raster source. */
export function legacyTileUrl(cfg: LegacyRasterConfig): string {
  const params = new URLSearchParams({
    base: cfg.base,
    size: String(cfg.imageSize),
    mult: String(cfg.multiplier),
    max: String(cfg.maxZoom),
  });
  return `${LEGACY_PROTOCOL}://{z}/{x}/{y}?${params}`;
}

/** Parses a concrete request URL produced from legacyTileUrl(). */
export function parseLegacyTileUrl(url: string): { z: number; x: number; y: number; cfg: LegacyRasterConfig } | null {
  const m = new RegExp(`^${LEGACY_PROTOCOL}://(\\d+)/(\\d+)/(\\d+)\\?(.*)$`).exec(url);
  if (!m) return null;
  const p = new URLSearchParams(m[4]);
  const base = p.get("base");
  if (!base) return null;
  return {
    z: Number(m[1]),
    x: Number(m[2]),
    y: Number(m[3]),
    cfg: {
      base,
      imageSize: Number(p.get("size")),
      multiplier: Number(p.get("mult")),
      maxZoom: Number(p.get("max")),
    },
  };
}

/** Legacy image pixel rectangle covered by a Web Mercator tile. */
export function mercatorTileToImageRect(
  z: number,
  x: number,
  y: number,
  cfg: Pick<LegacyRasterConfig, "imageSize" | "multiplier">,
): { left: number; top: number; right: number; bottom: number } {
  const n = 2 ** z;
  const lng = (tx: number) => (tx / n) * 360 - 180;
  const lat = (ty: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n))) * 180) / Math.PI;
  const px = (deg: number) => deg * METERS_PER_DEGREE * cfg.multiplier;
  const py = (deg: number) => cfg.imageSize - deg * METERS_PER_DEGREE * cfg.multiplier;
  return { left: px(lng(x)), right: px(lng(x + 1)), top: py(lat(y)), bottom: py(lat(y + 1)) };
}

/**
 * Picks the legacy zoom level whose resolution just meets the output tile's:
 * each legacy level L has 2^(maxZoom - L) image pixels per tile pixel.
 */
export function pickLegacyZoom(imagePxPerTilePx: number, maxZoom: number): number {
  const steps = Math.floor(Math.log2(Math.max(1, imagePxPerTilePx)));
  return Math.max(0, maxZoom - steps);
}

const TILE = 256;

async function renderTile(z: number, x: number, y: number, cfg: LegacyRasterConfig, signal: AbortSignal): Promise<ArrayBuffer> {
  const rect = mercatorTileToImageRect(z, x, y, cfg);
  const canvas = new OffscreenCanvas(TILE, TILE);
  // A CPU-backed canvas: small tiles composite fast in software, and
  // convertToBlob() then needs no slow read-back from the GPU.
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const outside = rect.right <= 0 || rect.left >= cfg.imageSize || rect.bottom <= 0 || rect.top >= cfg.imageSize;

  if (!outside) {
    const scale = TILE / (rect.right - rect.left); // tile px per image px
    const level = pickLegacyZoom(1 / scale, cfg.maxZoom);
    const span = TILE * 2 ** (cfg.maxZoom - level); // image px per legacy tile
    const maxIndex = Math.ceil(cfg.imageSize / span) - 1;
    const x0 = Math.max(0, Math.floor(rect.left / span));
    const x1 = Math.min(maxIndex, Math.floor((rect.right - 1e-6) / span));
    const y0 = Math.max(0, Math.floor(rect.top / span));
    const y1 = Math.min(maxIndex, Math.floor((rect.bottom - 1e-6) / span));

    const draws: Promise<void>[] = [];
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        draws.push(
          fetch(`${cfg.base}/${level}/${tx}/${ty}.png`, { signal })
            .then((res) => (res.ok ? res.blob() : null))
            .then((blob) => (blob ? createImageBitmap(blob) : null))
            .then((bmp) => {
              if (!bmp) return;
              const size = span * scale;
              ctx.drawImage(bmp, (tx * span - rect.left) * scale, (ty * span - rect.top) * scale, size, size);
              bmp.close();
            })
            .catch(() => {
              // Missing or aborted tile — leave that part transparent
            }),
        );
      }
    }
    await Promise.all(draws);
  }

  const blob = await canvas.convertToBlob({ type: "image/png" });
  return blob.arrayBuffer();
}

let registered = false;

/** Registers the protocol with MapLibre once per page. */
export function registerLegacyRasterProtocol(maplibregl: { addProtocol: (name: string, fn: any) => void }): void {
  if (registered) return;
  registered = true;
  maplibregl.addProtocol(LEGACY_PROTOCOL, async (params: { url: string }, abort: AbortController) => {
    const req = parseLegacyTileUrl(params.url);
    if (!req) throw new Error(`Bad legacy tile URL: ${params.url}`);
    return { data: await renderTile(req.z, req.x, req.y, req.cfg, abort.signal) };
  });
}

export interface LegacyStyle {
  label: string;
  /** Sub-folder under the world's tile base ("" = the topographic root set). */
  path: string;
}

/** The legacy tile sets a world offers, in the same order as the 2D renderer. */
export function legacyStyles(world: {
  hasTopo?: boolean;
  hasTopoDark?: boolean;
  hasTopoRelief?: boolean;
  hasColorRelief?: boolean;
}): LegacyStyle[] {
  const styles: LegacyStyle[] = [];
  if (world.hasTopo !== false) styles.push({ label: "Topographic", path: "" });
  if (world.hasTopoDark) styles.push({ label: "Topographic Dark", path: "topoDark" });
  if (world.hasTopoRelief) styles.push({ label: "Topographic Relief", path: "topoRelief" });
  if (world.hasColorRelief) styles.push({ label: "Color Relief", path: "colorRelief" });
  return styles;
}
