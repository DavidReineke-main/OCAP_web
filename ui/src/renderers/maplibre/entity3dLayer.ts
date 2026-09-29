import { METERS_PER_DEGREE, type ArmaCoord } from "../../utils/coordinates";
import { resolveVariant, ICON_PATHS, ICON_SIZES } from "../leaflet/canvasIcons";
import type { Side, AliveState } from "../../data/types";

/** Entity types rendered at true altitude by this layer rather than draped on the ground. */
export const AIRBORNE_ICON_TYPES = new Set(["heli", "plane", "parachute"]);

export interface AirborneEntityState {
  id: number;
  position: ArmaCoord;
  direction: number;
  iconType: string;
  side: Side | null;
  alive: AliveState;
  hit: boolean;
  name: string;
  showName: boolean;
  opacity: number;
}

function armaToLngLat(coords: ArmaCoord): [number, number] {
  return [coords[0] / METERS_PER_DEGREE, coords[1] / METERS_PER_DEGREE];
}

function loadImageEl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load: ${url}`));
    img.src = url;
  });
}

/** Multiplies a 4x4 column-major matrix by a homogeneous point, returning clip-space [x, y, z, w]. */
export function transformPoint(m: ArrayLike<number>, x: number, y: number, z: number): [number, number, number, number] {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
    m[3] * x + m[7] * y + m[11] * z + m[15],
  ];
}

/**
 * Renders airborne entities (aircraft, parachutes) at their true altitude
 * above the world's zero-elevation datum, with a dashed drop-line down to
 * the ground for AGL context — this is what makes "3D" actually visible for
 * flying units instead of them just being draped flat on the terrain like
 * ground vehicles and infantry.
 *
 * Implemented as a MapLibre CustomLayerInterface that draws into an
 * ordinary 2D canvas overlay rather than raw WebGL: each frame we project
 * each entity's 3D world position to screen space using the model-view-
 * projection matrix MapLibre hands us, then draw plain <img> icons. This
 * reuses the same server-generated marker images as the ground layer
 * without needing WebGL shaders/textures for a modest entity count.
 */
export class Entity3DLayer {
  readonly id = "entities-3d";
  readonly type = "custom" as const;
  readonly renderingMode = "3d" as const;

  private map: any = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private entities: AirborneEntityState[] = [];
  private readonly iconCache = new Map<string, HTMLImageElement | "loading" | "failed">();
  private resizeHandler: (() => void) | null = null;

  setEntities(entities: AirborneEntityState[]): void {
    this.entities = entities;
  }

  onAdd(map: any): void {
    this.map = map;
    const canvas = document.createElement("canvas");
    canvas.style.position = "absolute";
    canvas.style.top = "0";
    canvas.style.left = "0";
    canvas.style.pointerEvents = "none";
    map.getCanvasContainer().appendChild(canvas);
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.resize();
    this.resizeHandler = () => this.resize();
    map.on("resize", this.resizeHandler);
  }

  onRemove(): void {
    if (this.resizeHandler) {
      this.map?.off("resize", this.resizeHandler);
      this.resizeHandler = null;
    }
    this.canvas?.remove();
    this.canvas = null;
    this.ctx = null;
    this.map = null;
  }

  private resize(): void {
    if (!this.map || !this.canvas || !this.ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const { clientWidth, clientHeight } = this.map.getCanvasContainer();
    this.canvas.style.width = `${clientWidth}px`;
    this.canvas.style.height = `${clientHeight}px`;
    this.canvas.width = Math.max(1, Math.round(clientWidth * dpr));
    this.canvas.height = Math.max(1, Math.round(clientHeight * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private getIcon(key: string, url: string): HTMLImageElement | null {
    const cached = this.iconCache.get(key);
    if (cached === "loading" || cached === "failed") return null;
    if (cached) return cached;
    this.iconCache.set(key, "loading");
    loadImageEl(url)
      .then((img) => {
        this.iconCache.set(key, img);
        this.map?.triggerRepaint();
      })
      .catch(() => {
        this.iconCache.set(key, "failed");
      });
    return null;
  }

  /** Called by MapLibre every render frame (`render: CustomRenderMethod`). */
  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, options: { modelViewProjectionMatrix: ArrayLike<number> }): void {
    const ctx = this.ctx;
    const canvas = this.canvas;
    if (!ctx || !canvas) return;

    const cssWidth = canvas.width / (window.devicePixelRatio || 1);
    const cssHeight = canvas.height / (window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const matrix = options.modelViewProjectionMatrix;

    for (const e of this.entities) {
      const [lng, lat] = armaToLngLat(e.position);
      const altitude = e.position[2] ?? 0;
      const air = this.projectToScreen(matrix, lng, lat, altitude, cssWidth, cssHeight);
      const ground = this.projectToScreen(matrix, lng, lat, 0, cssWidth, cssHeight);
      if (!air) continue;

      if (ground && altitude > 1) {
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(air.x, air.y);
        ctx.lineTo(ground.x, ground.y);
        ctx.stroke();
        ctx.restore();

        ctx.beginPath();
        ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
        ctx.arc(ground.x, ground.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      const type = ICON_SIZES[e.iconType] ? e.iconType : "unknown";
      const size = ICON_SIZES[type];
      const variant = resolveVariant(e.alive, e.side, e.hit);
      const key = `${type}:${variant}`;
      const url = `${ICON_PATHS[type]}${variant}.svg`;
      const img = this.getIcon(key, url);

      ctx.save();
      ctx.globalAlpha = e.opacity;
      ctx.translate(air.x, air.y);
      ctx.rotate((e.direction * Math.PI) / 180);
      if (img) {
        ctx.drawImage(img, -size[0] / 2, -size[1] / 2, size[0], size[1]);
      } else {
        ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
        ctx.beginPath();
        ctx.arc(0, 0, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      if (e.showName) {
        ctx.save();
        ctx.font = "11px sans-serif";
        ctx.textAlign = "center";
        ctx.lineWidth = 2;
        ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
        ctx.fillStyle = "#ffffff";
        const labelY = air.y - size[1] / 2 - 6;
        ctx.strokeText(e.name, air.x, labelY);
        ctx.fillText(e.name, air.x, labelY);
        ctx.restore();
      }

      // Small altitude readout under the icon — the main point of this layer.
      ctx.save();
      ctx.font = "10px sans-serif";
      ctx.textAlign = "center";
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
      ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
      const altLabel = `${Math.round(altitude)}m`;
      const altY = air.y + size[1] / 2 + 12;
      ctx.strokeText(altLabel, air.x, altY);
      ctx.fillText(altLabel, air.x, altY);
      ctx.restore();
    }
  }

  private projectToScreen(
    matrix: ArrayLike<number>,
    lng: number,
    lat: number,
    altitude: number,
    cssWidth: number,
    cssHeight: number,
  ): { x: number; y: number } | null {
    const merc = lngLatAltToMercator(lng, lat, altitude);
    const [cx, cy, , cw] = transformPoint(matrix, merc.x, merc.y, merc.z);
    if (cw <= 0) return null;
    const ndcX = cx / cw;
    const ndcY = cy / cw;
    return {
      x: (ndcX * 0.5 + 0.5) * cssWidth,
      y: (1 - (ndcY * 0.5 + 0.5)) * cssHeight,
    };
  }
}

// Mirrors maplibre-gl's MercatorCoordinate.fromLngLat math (Web Mercator,
// world = [0,1]x[0,1], altitude scaled by the circumference at that latitude)
// so this layer doesn't need a runtime import of the maplibre-gl module.
const EARTH_CIRCUMFERENCE = 2 * Math.PI * 6378137;
export function lngLatAltToMercator(lng: number, lat: number, altitude: number): { x: number; y: number; z: number } {
  const x = (180 + lng) / 360;
  const latRad = (lat * Math.PI) / 180;
  const y = 0.5 - (0.25 * Math.log((1 + Math.sin(latRad)) / (1 - Math.sin(latRad)))) / Math.PI;
  const circumferenceAtLat = EARTH_CIRCUMFERENCE * Math.cos(latRad);
  const z = altitude / circumferenceAtLat;
  return { x, y, z };
}
