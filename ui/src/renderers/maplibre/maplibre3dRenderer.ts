import { createSignal, type Accessor, type Setter } from "solid-js";
import type { ArmaCoord } from "../../utils/coordinates";
import { METERS_PER_DEGREE } from "../../utils/coordinates";
import type { WorldConfig } from "../../data/types";
import type { MapRenderer } from "../renderer.interface";
import type {
  MarkerHandle,
  EntityMarkerOpts,
  EntityMarkerState,
  BriefingMarkerHandle,
  BriefingMarkerDef,
  BriefingMarkerState,
  LineHandle,
  LineOpts,
  RenderLayer,
  MapStyleInfo,
  RendererEvent,
  RendererControls,
} from "../renderer.types";
import { basePath } from "../../data/basePath";
import { resolveVariant, ICON_PATHS, ICON_SIZES, ICON_TYPES, ICON_VARIANTS } from "../leaflet/canvasIcons";
import { Entity3DLayer, AIRBORNE_ICON_TYPES, type AirborneEntityState } from "./entity3dLayer";

// --------------- Coordinate conversion (pure functions for testing) ---------------

/** Convert Arma [x, y] meters to MapLibre [lng, lat] degrees (same projection as the 2D MapLibre mode). */
export function armaToLngLat(coords: ArmaCoord): [number, number] {
  return [coords[0] / METERS_PER_DEGREE, coords[1] / METERS_PER_DEGREE];
}

/** Convert a MapLibre lng/lat back to Arma [x, y] meters. */
export function lngLatToArma(lngLat: { lng: number; lat: number }): ArmaCoord {
  return [lngLat.lng * METERS_PER_DEGREE, lngLat.lat * METERS_PER_DEGREE];
}

/** Clamp camera pitch to the range the plan specifies (0-85 degrees). */
export function clampPitch(pitch: number): number {
  return Math.min(85, Math.max(0, pitch));
}

/** Default pitch applied when switching into 3D mode. */
export const DEFAULT_3D_PITCH = 55;

/** Resolve an entity's registered icon image key ("type:variant"), falling back to "unknown". */
export function resolveEntityIconKey(
  iconType: string,
  side: import("../../data/types").Side | null,
  alive: import("../../data/types").AliveState,
  hit: boolean,
): string {
  const type = ICON_SIZES[iconType] ? iconType : "unknown";
  const variant = resolveVariant(alive, side, hit);
  return `${type}:${variant}`;
}

// --------------- Internal state ---------------

interface EntityFeatureState {
  id: number;
  position: ArmaCoord;
  direction: number;
  iconType: string;
  side: import("../../data/types").Side | null;
  name: string;
  isPlayer: boolean;
  isInVehicle: boolean;
  alive: import("../../data/types").AliveState;
  hit: boolean;
  crew?: import("../renderer.types").CrewInfo;
}

type BriefingGroup = "briefingMarkers" | "systemMarkers" | "projectileMarkers";

interface BriefingFeatureState {
  id: number;
  shape: "ICON" | "ELLIPSE" | "RECTANGLE" | "POLYLINE";
  group: BriefingGroup;
  color: string;
  iconType: string;
  isMagIcon: boolean;
  isTextOnly: boolean;
  text?: string;
  size?: [number, number];
  position: ArmaCoord;
  direction: number;
  alpha: number;
  points?: ArmaCoord[];
}

interface LineFeatureState {
  id: number;
  from: ArmaCoord;
  to: ArmaCoord;
  opts: LineOpts;
}

interface StyleCandidate {
  label: string;
  url: string;
}

function wrapId<T>(id: number): T {
  return { _brand: undefined as any, _internal: id } as unknown as T;
}

function unwrapId(handle: { _internal: unknown }): number {
  return handle._internal as number;
}

function loadImageEl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load: ${url}`));
    img.src = url;
  });
}

// map.addImage() only accepts HTMLImageElement | ImageBitmap | ImageData |
// {width,height,data} — not a raw HTMLCanvasElement — so pull ImageData back
// out of the canvas we rasterized onto.
function rasterize(img: HTMLImageElement, size: [number, number], dpr: number): ImageData | null {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(size[0] * dpr));
  canvas.height = Math.max(1, Math.round(size[1] * dpr));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

const GROUP_DEFAULT_VISIBLE: Record<BriefingGroup, boolean> = {
  briefingMarkers: true,
  systemMarkers: true,
  projectileMarkers: true,
};

// --------------- Renderer ---------------

/**
 * Native MapLibre GL JS renderer with 3D terrain and a tiltable/rotatable
 * camera. Unlike LeafletRenderer, this renders entities and briefing markers
 * as MapLibre GeoJSON + symbol/fill/line layers (draped on the terrain
 * surface) rather than DOM markers, since that's what lets MapLibre's
 * terrain engine place them correctly on the elevation mesh.
 *
 * Per-frame marker updates are batched: create/update/remove calls only
 * mutate in-memory state, and a microtask flush pushes one `setData()` per
 * affected source per frame instead of one per entity.
 */
export class MapLibre3DRenderer implements MapRenderer {
  private map: any = null;
  private world!: WorldConfig;
  private ready = false;
  private terrainExaggeration = 1.0;
  // Absolute base URL for this world's tile assets (e.g. "http://host/images/maps/altis"),
  // used both for style URLs and to manually attach a heightmap source to a
  // blank style when there's elevation data but no real MapLibre basemap.
  private tileBaseAbs: string | null = null;

  private readonly entityFeatures = new Map<number, EntityFeatureState>();
  private readonly briefingFeatures = new Map<number, BriefingFeatureState>();
  private readonly lineFeatures = new Map<number, LineFeatureState>();
  private nextBriefingId = 1;
  private nextLineId = 1;

  // Persists across style switches (setStyle() wipes regular layers, so we
  // re-add this to the new style each time, but keep the same instance and
  // its DOM canvas overlay / icon cache alive).
  private readonly entity3DLayer = new Entity3DLayer();

  private entitiesDirty = false;
  private briefingDirty = false;
  private linesDirty = false;
  private flushScheduled = false;

  // True once the camera has been auto-fit to the recording's entities.
  // Without a real map, init() only knows the (often huge, e.g. 30720m
  // Altis-sized placeholder) nominal world square — fitting to that leaves
  // a small mission tucked into a corner, effectively invisible. We fit to
  // the actual entity bounds once real position data arrives instead, but
  // only the first time, so it doesn't fight the user's own panning/zooming.
  private hasFitToEntities = false;

  private readonly loadedBriefingIcons = new Set<string>();

  private readonly groupVisible: Record<BriefingGroup, boolean> = { ...GROUP_DEFAULT_VISIBLE };

  private styleCandidates: StyleCandidate[] = [];
  private fetchStyle: ((url: string) => Promise<any>) | null = null;

  // Signal-backed display mode state (mirrors LeafletRenderer)
  private readonly _nameDisplayMode: Accessor<"players" | "all" | "none">;
  private readonly _setNameDisplayMode: Setter<"players" | "all" | "none">;
  private readonly _markerDisplayMode: Accessor<"all" | "noLabels" | "none">;
  private readonly _setMarkerDisplayMode: Setter<"all" | "noLabels" | "none">;
  private readonly _projectileLabels: Accessor<boolean>;
  private readonly _setProjectileLabels: Setter<boolean>;
  private readonly _mapStylesSig: Accessor<MapStyleInfo[]>;
  private readonly _setMapStylesSig: Setter<MapStyleInfo[]>;
  private readonly _activeStyleIndexSig: Accessor<number>;
  private readonly _setActiveStyleIndexSig: Setter<number>;
  private readonly _layerVisibility: Accessor<Record<string, boolean>>;
  private readonly _setLayerVisibility: Setter<Record<string, boolean>>;
  private readonly _is3D: Accessor<boolean>;
  private readonly _setIs3D: Setter<boolean>;

  private listeners = new Map<RendererEvent, Set<(...args: any[]) => void>>();

  constructor() {
    const [ndm, setNdm] = createSignal<"players" | "all" | "none">("players");
    this._nameDisplayMode = ndm;
    this._setNameDisplayMode = setNdm;

    const [mdm, setMdm] = createSignal<"all" | "noLabels" | "none">("all");
    this._markerDisplayMode = mdm;
    this._setMarkerDisplayMode = setMdm;

    const [pl, setPl] = createSignal<boolean>(true);
    this._projectileLabels = pl;
    this._setProjectileLabels = setPl;

    const [ms, setMs] = createSignal<MapStyleInfo[]>([]);
    this._mapStylesSig = ms;
    this._setMapStylesSig = setMs;

    const [asi, setAsi] = createSignal(0);
    this._activeStyleIndexSig = asi;
    this._setActiveStyleIndexSig = setAsi;

    const [lv, setLv] = createSignal<Record<string, boolean>>({
      entities: true,
      systemMarkers: true,
      projectileMarkers: true,
      grid: false,
      mapIcons: true,
      buildings3D: true,
    });
    this._layerVisibility = lv;
    this._setLayerVisibility = setLv;

    const [is3d, setIs3d] = createSignal(true);
    this._is3D = is3d;
    this._setIs3D = setIs3d;
  }

  // ==================== Lifecycle ====================

  init(container: HTMLElement, world: WorldConfig): void {
    this.world = world;
    this.terrainExaggeration = world.terrainExaggeration ?? 1.0;

    void this.initAsync(container, world);
  }

  private async initAsync(container: HTMLElement, world: WorldConfig): Promise<void> {
    const worldSizeDeg = world.worldSize / METERS_PER_DEGREE;
    const center: [number, number] = [worldSizeDeg / 2, worldSizeDeg / 2];

    const absBase = new URL(basePath, window.location.origin).href;

    // Some worlds only have the legacy raster tile pipeline (no MapLibre
    // style / PMTiles), e.g. when apiClient.getWorldConfig() falls back to
    // the legacy CDN tier. This renderer has no raster fallback of its own
    // (unlike LeafletRenderer), so without a real style it just runs with a
    // blank basemap — still gives working 3D camera + entity/briefing layers.
    const canUseMapLibreStyle = Boolean(world.maplibre && world.tileBaseUrl);

    let initialStyle: any = { version: 8, sources: {}, layers: [] };
    let transformRequest: ((url: string) => { url: string }) | undefined;

    // Registered unconditionally (not just when canUseMapLibreStyle) — a
    // heightmap can be manually attached to a blank style (see
    // onStyleLoaded) for worlds that have elevation data but no real
    // MapLibre style/basemap imagery yet.
    if (!(window as any)._pmtilesRegistered) {
      try {
        const { Protocol } = await import("pmtiles");
        const maplibregl = await import("maplibre-gl");
        const protocol = new Protocol();
        maplibregl.addProtocol("pmtiles", (params: any, ac: AbortController) => {
          const rest = params.url.slice("pmtiles://".length);
          if (!rest.startsWith("http") && !rest.startsWith("/")) {
            return protocol.tile({ ...params, url: "pmtiles://" + absBase + rest }, ac);
          }
          return protocol.tile(params, ac);
        });
        (window as any)._pmtilesRegistered = true;
      } catch {
        // PMTiles not available — MapLibre may still work without PMTiles sources
      }
    }

    if (world.tileBaseUrl) {
      const raw = world.tileBaseUrl;
      this.tileBaseAbs = raw.startsWith("http") ? raw : new URL(raw, window.location.origin).href;
    }

    if (canUseMapLibreStyle) {
      const isAbsoluteUrl = (u: string) => /^(\w+:)?\/\/|^data:/.test(u);
      const makeAbsolute = (u: string) => (isAbsoluteUrl(u) ? u : absBase + u.replace(/^\//, ""));
      transformRequest = (url: string) => ({ url: makeAbsolute(url) });

      // Unlike the 2D LeafletRenderer, we keep `style.terrain` — it's what
      // makes MapLibre drape the elevation mesh and our GeoJSON layers on it.
      const fetchStyle = async (url: string) => {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Style fetch failed: ${resp.status} ${url}`);
        const style = await resp.json();
        if (typeof style.sprite === "string") {
          style.sprite = makeAbsolute(style.sprite);
        } else if (Array.isArray(style.sprite)) {
          style.sprite = style.sprite.map((s: any) => ({ ...s, url: makeAbsolute(s.url) }));
        }
        if (typeof style.glyphs === "string") {
          style.glyphs = makeAbsolute(style.glyphs);
        }
        return style;
      };
      this.fetchStyle = fetchStyle;

      const styleBase = this.tileBaseAbs + "/styles/";
      this.styleCandidates = [
        { label: "Topographic", url: styleBase + "topo.json" },
        { label: "Topographic Dark", url: styleBase + "topo-dark.json" },
        { label: "Color Relief", url: styleBase + "color-relief.json" },
        { label: "Topographic Relief", url: styleBase + "topo-relief.json" },
      ];
      const savedIdx = parseInt(localStorage.getItem("ocap-maplibre-style") ?? "0", 10) || 0;
      const initialIdx = savedIdx >= 0 && savedIdx < this.styleCandidates.length ? savedIdx : 0;

      try {
        initialStyle = await fetchStyle(this.styleCandidates[initialIdx].url);
        this._setActiveStyleIndexSig(initialIdx);
        this._setMapStylesSig(
          this.styleCandidates.map((c) => ({ label: c.label, available: false })),
        );
      } catch (err) {
        console.warn(
          `[MapLibre3DRenderer] Could not load a MapLibre style for "${world.worldName}" — falling back to a blank basemap.`,
          err,
        );
        this.styleCandidates = [];
        initialStyle = { version: 8, sources: {}, layers: [] };
      }
    }

    const maplibregl = await import("maplibre-gl");
    this.map = new maplibregl.Map({
      container,
      style: initialStyle,
      center,
      zoom: 12,
      pitch: this._is3D() ? DEFAULT_3D_PITCH : 0,
      bearing: 0,
      maxZoom: 20,
      minZoom: world.minZoom ?? 10,
      maxPitch: 85,
      attributionControl: false,
      transformRequest,
    });

    this.map.addControl(
      new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }),
      "top-right",
    );
    this.map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

    this.map.on("zoom", () => {
      this.fireEvent("zoom", this.map.getZoom());
      this.scheduleFlush();
    });
    this.map.on("dragstart", () => this.fireEvent("dragstart"));
    this.map.on("click", (e: any) => this.fireEvent("click", lngLatToArma(e.lngLat)));
    // MapLibre reports style/layer validation failures via this event rather
    // than throwing — without a listener it dumps a large console.error with
    // no context, so surface it as a short warning instead.
    this.map.on("error", (e: any) => {
      console.warn("[MapLibre3DRenderer]", e?.error?.message ?? e);
    });

    this.map.on("style.load", () => {
      this.onStyleLoaded();
    });

    this.map.once("load", () => {
      this.map.fitBounds(
        [
          [0, 0],
          [worldSizeDeg, worldSizeDeg],
        ],
        { animate: false },
      );
      this.probeStyleAvailability();
      void this.preloadEntityIcons();
    });
  }

  private probeStyleAvailability(): void {
    const probes = this.styleCandidates.map((c, i) => {
      const ctrl = new AbortController();
      return fetch(c.url, { method: "HEAD", signal: ctrl.signal })
        .then((res) => {
          ctrl.abort();
          return { index: i, ok: res.ok };
        })
        .catch(() => ({ index: i, ok: false }));
    });
    Promise.all(probes).then((results) => {
      this._setMapStylesSig((prev) => {
        const updated = [...prev];
        for (const r of results) {
          updated[r.index] = { ...updated[r.index], available: r.ok };
        }
        return updated;
      });
    });
  }

  /** (Re)creates our custom sources/layers. Runs on initial style load and after every setStyle(). */
  private onStyleLoaded(): void {
    if (!this.map) return;

    if (this.world.hasHeightmap) {
      // A real generated style already declares this source; a blank/no-basemap
      // style doesn't, so attach it manually — elevation data is independently
      // useful even without real basemap imagery on top of it. Prefer
      // world.heightmapUrl (set when elevation was resolved separately from
      // basemap imagery, e.g. local heightmap + CDN-hosted imagery); fall
      // back to deriving it from tileBaseAbs for a genuine single-source
      // (fully local or fully CDN) deployment.
      const heightmapUrl =
        this.world.heightmapUrl ?? (this.tileBaseAbs ? this.tileBaseAbs + "/tiles/heightmap.pmtiles" : null);
      if (!this.map.getSource("heightmap") && heightmapUrl) {
        try {
          this.map.addSource("heightmap", {
            type: "raster-dem",
            url: "pmtiles://" + heightmapUrl,
            tileSize: 256,
          });
        } catch (err) {
          console.warn("[MapLibre3DRenderer] Could not attach heightmap source", err);
        }
      }
      if (this.map.getSource("heightmap")) {
        this.map.setTerrain({ source: "heightmap", exaggeration: this.terrainExaggeration });
      }
    }

    // A blank style (see initAsync) has literally zero layers — setTerrain()
    // still displaces the mesh, but nothing paints it, so the terrain is
    // elevationally "there" yet completely invisible (transparent). Add a
    // flat ground color plus a hillshade layer generated straight from the
    // heightmap DEM so relief is actually visible without needing real
    // basemap imagery. Real styles already have their own layers — skip.
    if (this.usingBlankBasemap) {
      if (!this.map.getLayer("bg")) {
        this.map.addLayer({ id: "bg", type: "background", paint: { "background-color": "#3a4a34" } });
      }
      if (this.map.getSource("heightmap") && !this.map.getLayer("heightmap-hillshade")) {
        this.map.addLayer({
          id: "heightmap-hillshade",
          type: "hillshade",
          source: "heightmap",
          paint: { "hillshade-exaggeration": 1 },
        });
      }
    }

    // MapLibre GL JS models sky as map-level state (Map.setSky()), not a
    // style layer — unlike Mapbox GL's `{type: "sky"}` layer.
    try {
      this.map.setSky({
        "sky-color": "#88c6fc",
        "horizon-color": "#ffffff",
        "fog-color": "#ffffff",
      });
    } catch {
      // Sky unsupported by this MapLibre build — purely cosmetic, skip
    }

    this.map.addSource("entities", { type: "geojson", data: this.buildEntityFeatureCollection() });
    this.map.addLayer({
      id: "entities-icons",
      type: "symbol",
      source: "entities",
      layout: {
        "icon-image": ["get", "iconImage"],
        "icon-rotate": ["get", "rotation"],
        "icon-rotation-alignment": "map",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        visibility: this._layerVisibility().entities === false ? "none" : "visible",
      },
      paint: { "icon-opacity": ["get", "iconOpacity"] },
    });
    this.map.addLayer({
      id: "entities-labels",
      type: "symbol",
      source: "entities",
      filter: ["==", ["get", "showName"], true],
      layout: {
        "text-field": ["get", "name"],
        "text-size": 11,
        "text-offset": [0, 1.2],
        "text-anchor": "top",
        "text-allow-overlap": true,
        "text-ignore-placement": true,
        "text-optional": true,
        visibility: this._layerVisibility().entities === false ? "none" : "visible",
      },
      paint: { "text-color": "#ffffff", "text-halo-color": "#000000", "text-halo-width": 1 },
    });

    this.map.addSource("briefing-icons", { type: "geojson", data: this.buildBriefingIconFeatures() });
    this.map.addLayer({
      id: "briefing-icons",
      type: "symbol",
      source: "briefing-icons",
      filter: this.groupFilter(),
      layout: {
        "icon-image": ["get", "iconImage"],
        "icon-size": 1,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
      paint: { "icon-opacity": ["get", "alpha"] },
    });
    this.map.addLayer({
      id: "briefing-labels",
      type: "symbol",
      source: "briefing-icons",
      filter: ["all", this.groupFilter(), ["==", ["get", "showLabel"], true]],
      layout: {
        "text-field": ["get", "text"],
        "text-size": 12,
        "text-anchor": "left",
        "text-offset": [0.6, 0],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
        "text-optional": true,
      },
      paint: { "text-color": "#ffffff", "text-halo-color": "#000000", "text-halo-width": 1 },
    });

    this.map.addSource("briefing-polygons", { type: "geojson", data: this.buildBriefingPolygonFeatures() });
    this.map.addLayer({
      id: "briefing-polygons-fill",
      type: "fill",
      source: "briefing-polygons",
      filter: this.groupFilter(),
      paint: { "fill-color": ["get", "color"], "fill-opacity": ["get", "fillOpacity"] },
    });
    this.map.addLayer({
      id: "briefing-polygons-line",
      type: "line",
      source: "briefing-polygons",
      filter: this.groupFilter(),
      paint: { "line-color": ["get", "color"], "line-opacity": ["get", "alpha"], "line-width": 2 },
    });

    this.map.addSource("briefing-lines", { type: "geojson", data: this.buildBriefingLineFeatures() });
    this.map.addLayer({
      id: "briefing-lines",
      type: "line",
      source: "briefing-lines",
      filter: this.groupFilter(),
      paint: { "line-color": ["get", "color"], "line-opacity": ["get", "alpha"], "line-width": 2 },
    });

    this.map.addSource("fire-lines", { type: "geojson", data: this.buildLineFeatures() });
    this.map.addLayer({
      id: "fire-lines",
      type: "line",
      source: "fire-lines",
      layout: { visibility: this._layerVisibility().projectileMarkers === false ? "none" : "visible" },
      paint: {
        "line-color": ["get", "color"],
        "line-opacity": ["get", "opacity"],
        "line-width": ["get", "weight"],
      },
    });

    if (!this.map.getLayer(this.entity3DLayer.id)) {
      this.map.addLayer(this.entity3DLayer);
    }
    this.entity3DLayer.setEntities(this.buildAirborneEntities());

    this.entitiesDirty = false;
    this.briefingDirty = false;
    this.linesDirty = false;
    this.ready = true;
  }

  private async preloadEntityIcons(): Promise<void> {
    if (!this.map) return;
    const dpr = window.devicePixelRatio || 1;
    const loads: Promise<void>[] = [];
    for (const type of ICON_TYPES) {
      const path = ICON_PATHS[type];
      const size = ICON_SIZES[type];
      for (const variant of ICON_VARIANTS) {
        const url = `${path}${variant}.svg`;
        const key = `${type}:${variant}`;
        loads.push(
          loadImageEl(url)
            .then((img) => {
              if (!this.map || this.map.hasImage(key)) return;
              const pixels = rasterize(img, size, dpr);
              if (pixels) this.map.addImage(key, pixels, { pixelRatio: dpr });
            })
            .catch(() => {
              // Some type/variant combos may not exist — skip silently
            }),
        );
      }
    }
    await Promise.all(loads);
    this.entitiesDirty = true;
    this.scheduleFlush();
  }

  private ensureBriefingIcon(key: string, url: string, size: [number, number]): void {
    if (this.loadedBriefingIcons.has(key) || !this.map) return;
    this.loadedBriefingIcons.add(key);
    const dpr = window.devicePixelRatio || 1;
    loadImageEl(url)
      .then((img) => {
        if (!this.map || this.map.hasImage(key)) return;
        const pixels = rasterize(img, size, dpr);
        if (!pixels) return;
        this.map.addImage(key, pixels, { pixelRatio: dpr });
        this.briefingDirty = true;
        this.scheduleFlush();
      })
      .catch(() => {
        // Missing marker image — feature just won't render an icon
      });
  }

  dispose(): void {
    this.listeners.clear();
    this.entityFeatures.clear();
    this.briefingFeatures.clear();
    this.lineFeatures.clear();
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
    this.ready = false;
  }

  // ==================== Batched GeoJSON flush ====================

  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => this.flush());
  }

  private flush(): void {
    this.flushScheduled = false;
    if (!this.ready || !this.map) return;

    if (this.entitiesDirty) {
      const source = this.map.getSource("entities");
      source?.setData(this.buildEntityFeatureCollection());
      this.entity3DLayer.setEntities(this.buildAirborneEntities());
      this.map.triggerRepaint();
      this.entitiesDirty = false;
      this.fitToEntitiesIfNeeded();
    }
    if (this.briefingDirty) {
      this.map.getSource("briefing-icons")?.setData(this.buildBriefingIconFeatures());
      this.map.getSource("briefing-polygons")?.setData(this.buildBriefingPolygonFeatures());
      this.map.getSource("briefing-lines")?.setData(this.buildBriefingLineFeatures());
      this.briefingDirty = false;
    }
    if (this.linesDirty) {
      this.map.getSource("fire-lines")?.setData(this.buildLineFeatures());
      this.linesDirty = false;
    }
  }

  private fitToEntitiesIfNeeded(): void {
    if (this.hasFitToEntities || !this.map || this.entityFeatures.size === 0) return;
    this.hasFitToEntities = true;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const e of this.entityFeatures.values()) {
      minX = Math.min(minX, e.position[0]);
      minY = Math.min(minY, e.position[1]);
      maxX = Math.max(maxX, e.position[0]);
      maxY = Math.max(maxY, e.position[1]);
    }
    // Pad a tight/single-point cluster so fitBounds doesn't zoom in absurdly far.
    const padMeters = Math.max(200, (maxX - minX) * 0.2, (maxY - minY) * 0.2);
    this.map.fitBounds(
      [
        armaToLngLat([minX - padMeters, minY - padMeters]),
        armaToLngLat([maxX + padMeters, maxY + padMeters]),
      ],
      { animate: false, maxZoom: 17 },
    );
  }

  // ==================== Coordinate conversion ====================

  protected armaToLngLat(coords: ArmaCoord): [number, number] {
    return armaToLngLat(coords);
  }

  // ==================== Camera ====================

  getZoom(): number {
    return this.map?.getZoom() ?? 0;
  }

  setView(armaPos: ArmaCoord, zoom?: number, animate?: boolean): void {
    if (!this.map) return;
    const center = armaToLngLat(armaPos);
    const targetZoom = zoom ?? this.map.getZoom();
    if (animate ?? true) {
      this.map.easeTo({ center, zoom: targetZoom, duration: 500 });
    } else {
      this.map.jumpTo({ center, zoom: targetZoom });
    }
  }

  fitBounds(sw: ArmaCoord, ne: ArmaCoord): void {
    if (!this.map) return;
    this.map.fitBounds([armaToLngLat(sw), armaToLngLat(ne)], { animate: false });
  }

  getCenter(): ArmaCoord {
    if (!this.map) return [0, 0];
    return lngLatToArma(this.map.getCenter());
  }

  // ==================== 3D camera & mode ====================

  get is3DMode() {
    return this._is3D;
  }

  set3DMode(enabled: boolean): void {
    this._setIs3D(enabled);
    if (!this.map) return;
    this.map.easeTo({
      pitch: enabled ? DEFAULT_3D_PITCH : 0,
      bearing: enabled ? this.map.getBearing() : 0,
      duration: 600,
    });
  }

  getPitch(): number {
    return this.map?.getPitch() ?? 0;
  }

  setPitch(pitch: number): void {
    if (!this.map) return;
    this.map.easeTo({ pitch: clampPitch(pitch), duration: 200 });
  }

  getBearing(): number {
    return this.map?.getBearing() ?? 0;
  }

  setBearing(bearing: number): void {
    this.map?.easeTo({ bearing, duration: 200 });
  }

  setTerrainExaggeration(exaggeration: number): void {
    this.terrainExaggeration = exaggeration;
    if (this.map && this.world?.hasHeightmap && this.map.getSource("heightmap")) {
      this.map.setTerrain({ source: "heightmap", exaggeration });
    }
  }

  // ==================== Entity markers ====================

  createEntityMarker(id: number, opts: EntityMarkerOpts): MarkerHandle {
    this.entityFeatures.set(id, {
      id,
      position: opts.position,
      direction: opts.direction,
      iconType: opts.iconType,
      side: opts.side,
      name: opts.name,
      isPlayer: opts.isPlayer,
      isInVehicle: false,
      alive: 1,
      hit: false,
      crew: opts.crew,
    });
    this.entitiesDirty = true;
    this.scheduleFlush();
    return wrapId<MarkerHandle>(id);
  }

  updateEntityMarker(handle: MarkerHandle, state: EntityMarkerState): void {
    const id = unwrapId(handle as any);
    const existing = this.entityFeatures.get(id);
    if (!existing) return;
    existing.position = state.position;
    existing.direction = state.direction;
    existing.alive = state.alive;
    existing.side = state.side;
    existing.name = state.name;
    existing.iconType = state.iconType;
    existing.isPlayer = state.isPlayer;
    existing.isInVehicle = state.isInVehicle;
    existing.hit = !!state.hit;
    existing.crew = state.crew;
    this.entitiesDirty = true;
    this.scheduleFlush();
  }

  removeEntityMarker(handle: MarkerHandle): void {
    const id = unwrapId(handle as any);
    this.entityFeatures.delete(id);
    this.entitiesDirty = true;
    this.scheduleFlush();
  }

  /** Whether an entity should show its name label right now (shared by the ground layer and the airborne layer). */
  private computeShowName(e: EntityFeatureState, hideNames: boolean): boolean {
    const nameMode = this._nameDisplayMode();
    const crewHasPlayer = !!e.crew && e.crew.names.length > 0;
    if (e.isInVehicle) return false;
    if (hideNames) return false;
    if (nameMode === "none") return false;
    if (nameMode === "players" && !e.isPlayer && !crewHasPlayer) return false;
    return true;
  }

  private buildEntityFeatureCollection(): any {
    const zoom = this.map?.getZoom() ?? 12;
    const hideNames = zoom <= 14;
    const features = [];
    for (const e of this.entityFeatures.values()) {
      // Aircraft/parachutes render at true altitude via Entity3DLayer instead.
      if (AIRBORNE_ICON_TYPES.has(e.iconType)) continue;

      const showName = this.computeShowName(e, hideNames);
      const iconOpacity = e.isInVehicle ? 0 : e.alive === 0 ? 0.4 : 1;
      const name = e.crew ? `${e.name} (${e.crew.count})` : e.name;

      features.push({
        type: "Feature",
        id: e.id,
        geometry: { type: "Point", coordinates: this.armaToLngLat(e.position) },
        properties: {
          iconImage: resolveEntityIconKey(e.iconType, e.side, e.alive, e.hit),
          rotation: e.direction,
          name,
          showName,
          iconOpacity,
        },
      });
    }
    return { type: "FeatureCollection", features };
  }

  private buildAirborneEntities(): AirborneEntityState[] {
    const zoom = this.map?.getZoom() ?? 12;
    const hideNames = zoom <= 14;
    const airborne: AirborneEntityState[] = [];
    for (const e of this.entityFeatures.values()) {
      if (!AIRBORNE_ICON_TYPES.has(e.iconType)) continue;
      airborne.push({
        id: e.id,
        position: e.position,
        direction: e.direction,
        iconType: e.iconType,
        side: e.side,
        alive: e.alive,
        hit: e.hit,
        name: e.crew ? `${e.name} (${e.crew.count})` : e.name,
        showName: this.computeShowName(e, hideNames),
        opacity: e.isInVehicle ? 0 : e.alive === 0 ? 0.4 : 1,
      });
    }
    return airborne;
  }

  // ==================== Briefing markers ====================

  createBriefingMarker(def: BriefingMarkerDef): BriefingMarkerHandle {
    const id = this.nextBriefingId++;
    const isTextOnly = def.type.includes("Empty") && !!def.text;
    const isMagIcon = def.type.indexOf("magIcons") > -1;

    this.briefingFeatures.set(id, {
      id,
      shape: def.shape,
      group: def.layer ?? "briefingMarkers",
      color: `#${def.color}`,
      iconType: def.type,
      isMagIcon,
      isTextOnly,
      text: def.text,
      size: def.size,
      position: [0, 0],
      direction: 0,
      alpha: 1,
    });

    if (def.shape === "ICON" && !isTextOnly) {
      const b = basePath;
      const key = isMagIcon ? `magicon:${def.type.toLowerCase()}` : `briefing:${def.type}:${def.color}`;
      const url = isMagIcon
        ? `${b}images/markers/${def.type.toLowerCase()}.png`
        : `${b}images/markers/${def.type}/${def.color}.png`;
      const size: [number, number] = def.size ? [def.size[0] * 35, def.size[1] * 35] : [35, 35];
      this.ensureBriefingIcon(key, url, size);
    }

    this.briefingDirty = true;
    this.scheduleFlush();
    return wrapId<BriefingMarkerHandle>(id);
  }

  updateBriefingMarker(handle: BriefingMarkerHandle, state: BriefingMarkerState): void {
    const id = unwrapId(handle as any);
    const existing = this.briefingFeatures.get(id);
    if (!existing) return;
    existing.position = state.position;
    existing.direction = state.direction;
    existing.alpha = state.alpha;
    existing.points = state.points;
    this.briefingDirty = true;
    this.scheduleFlush();
  }

  removeBriefingMarker(handle: BriefingMarkerHandle): void {
    const id = unwrapId(handle as any);
    this.briefingFeatures.delete(id);
    this.briefingDirty = true;
    this.scheduleFlush();
  }

  private briefingIconKey(f: BriefingFeatureState): string {
    return f.isMagIcon ? `magicon:${f.iconType.toLowerCase()}` : `briefing:${f.iconType}:${f.color.slice(1)}`;
  }

  private buildBriefingIconFeatures(): any {
    const showLabels = this._markerDisplayMode() === "all";
    const showProjectileLabels = this._projectileLabels();
    const features = [];
    for (const f of this.briefingFeatures.values()) {
      if (f.shape !== "ICON") continue;
      const labelVisible = f.group === "projectileMarkers" ? showProjectileLabels : showLabels;
      features.push({
        type: "Feature",
        id: f.id,
        geometry: { type: "Point", coordinates: armaToLngLat(f.position) },
        properties: {
          iconImage: f.isTextOnly ? "" : this.briefingIconKey(f),
          rotation: f.direction,
          alpha: f.alpha,
          text: f.text ?? "",
          showLabel: !!f.text && (f.isTextOnly || labelVisible),
          group: f.group,
        },
      });
    }
    return { type: "FeatureCollection", features };
  }

  private buildBriefingPolygonFeatures(): any {
    const features = [];
    for (const f of this.briefingFeatures.values()) {
      if (f.shape !== "ELLIPSE" && f.shape !== "RECTANGLE") continue;
      const [cx, cy] = f.position;
      const sx = f.size?.[0] ?? 100;
      const sy = f.size?.[1] ?? 100;
      // Negate angle: Arma directions are clockwise from north, standard
      // rotation matrices are counter-clockwise.
      const rad = -f.direction * (Math.PI / 180);
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);

      let corners: [number, number][];
      if (f.shape === "ELLIPSE") {
        corners = [];
        for (let i = 0; i < 36; i++) {
          const angle = (i / 36) * 2 * Math.PI;
          corners.push([sx * Math.cos(angle), sy * Math.sin(angle)]);
        }
      } else {
        corners = [
          [-sx, sy],
          [sx, sy],
          [sx, -sy],
          [-sx, -sy],
        ];
      }
      const ring = corners.map(([dx, dy]) =>
        armaToLngLat([cx + cos * dx - sin * dy, cy + sin * dx + cos * dy]),
      );
      ring.push(ring[0]);

      features.push({
        type: "Feature",
        id: f.id,
        geometry: { type: "Polygon", coordinates: [ring] },
        properties: { color: f.color, alpha: f.alpha, fillOpacity: 0.3 * f.alpha, group: f.group },
      });
    }
    return { type: "FeatureCollection", features };
  }

  private buildBriefingLineFeatures(): any {
    const features = [];
    for (const f of this.briefingFeatures.values()) {
      if (f.shape !== "POLYLINE" || !f.points || f.points.length < 2) continue;
      features.push({
        type: "Feature",
        id: f.id,
        geometry: { type: "LineString", coordinates: f.points.map((p) => armaToLngLat(p)) },
        properties: { color: f.color, alpha: f.alpha, group: f.group },
      });
    }
    return { type: "FeatureCollection", features };
  }

  private groupFilter(): any {
    const visible = (["briefingMarkers", "systemMarkers", "projectileMarkers"] as BriefingGroup[]).filter(
      (g) => this.groupVisible[g],
    );
    return ["in", ["get", "group"], ["literal", visible]];
  }

  private applyGroupFilters(): void {
    if (!this.map || !this.ready) return;
    const filter = this.groupFilter();
    this.map.setFilter("briefing-icons", filter);
    this.map.setFilter("briefing-labels", ["all", filter, ["==", ["get", "showLabel"], true]]);
    this.map.setFilter("briefing-polygons-fill", filter);
    this.map.setFilter("briefing-polygons-line", filter);
    this.map.setFilter("briefing-lines", filter);
  }

  // ==================== Lines (fire lines / kill lines) ====================

  addLine(from: ArmaCoord, to: ArmaCoord, opts: LineOpts): LineHandle {
    const id = this.nextLineId++;
    this.lineFeatures.set(id, { id, from, to, opts });
    this.linesDirty = true;
    this.scheduleFlush();
    return wrapId<LineHandle>(id);
  }

  removeLine(handle: LineHandle): void {
    const id = unwrapId(handle as any);
    this.lineFeatures.delete(id);
    this.linesDirty = true;
    this.scheduleFlush();
  }

  private buildLineFeatures(): any {
    const features = [];
    for (const l of this.lineFeatures.values()) {
      features.push({
        type: "Feature",
        id: l.id,
        geometry: {
          type: "LineString",
          coordinates: [armaToLngLat(l.from), armaToLngLat(l.to)],
        },
        properties: { color: l.opts.color, opacity: l.opts.opacity, weight: l.opts.weight },
      });
    }
    return { type: "FeatureCollection", features };
  }

  // ==================== Layer visibility ====================

  get layerVisibility() {
    return this._layerVisibility;
  }
  get nameDisplayMode() {
    return this._nameDisplayMode;
  }
  get markerDisplayMode() {
    return this._markerDisplayMode;
  }
  get projectileLabelsVisible() {
    return this._projectileLabels;
  }
  get mapStyles() {
    return this._mapStylesSig;
  }
  get activeStyleIndex() {
    return this._activeStyleIndexSig;
  }

  setLayerVisible(layer: RenderLayer, visible: boolean): void {
    this._setLayerVisibility((prev) => ({ ...prev, [layer]: visible }));

    if (layer === "entities") {
      if (this.map?.getLayer("entities-icons")) {
        this.map.setLayoutProperty("entities-icons", "visibility", visible ? "visible" : "none");
        this.map.setLayoutProperty("entities-labels", "visibility", visible ? "visible" : "none");
      }
      return;
    }
    if (layer === "projectileMarkers" && this.map?.getLayer("fire-lines")) {
      this.map.setLayoutProperty("fire-lines", "visibility", visible ? "visible" : "none");
    }
    if (layer === "briefingMarkers" || layer === "systemMarkers" || layer === "projectileMarkers") {
      this.groupVisible[layer] = visible;
      this.applyGroupFilters();
      return;
    }
    if (layer === "mapIcons") {
      this.setStyleIconVisibility(visible ? "visible" : "none");
      return;
    }
    if (layer === "buildings3D") {
      this.setBuildings3DVisibility(visible ? "visible" : "none");
      return;
    }
    // "grid" has no 3D implementation yet — tracked in the signal only.
  }

  private setStyleIconVisibility(vis: "visible" | "none"): void {
    if (!this.map?.getStyle()) return;
    for (const layer of this.map.getStyle().layers) {
      if (layer.type === "symbol" && layer.layout?.["icon-image"] && !layer.id.startsWith("entities") && !layer.id.startsWith("briefing")) {
        this.map.setLayoutProperty(layer.id, "visibility", vis);
      }
    }
  }

  private setBuildings3DVisibility(vis: "visible" | "none"): void {
    if (!this.map?.getStyle()) return;
    for (const layer of this.map.getStyle().layers) {
      if (layer.type === "fill-extrusion" && !layer.id.includes("bridge")) {
        this.map.setLayoutProperty(layer.id, "visibility", vis);
      }
    }
  }

  // ==================== Settings ====================

  setSmoothingEnabled(_enabled: boolean, _frameIntervalSec?: number): void {
    // no-op — GeoJSON source updates are already batched per frame
  }

  setNameDisplayMode(mode: "players" | "all" | "none"): void {
    this._setNameDisplayMode(mode);
    this.entitiesDirty = true;
    this.scheduleFlush();
  }

  setMarkerDisplayMode(mode: "all" | "noLabels" | "none"): void {
    this._setMarkerDisplayMode(mode);
    this.briefingDirty = true;
    this.scheduleFlush();
  }

  setProjectileLabelsVisible(visible: boolean): void {
    this._setProjectileLabels(visible);
    this.briefingDirty = true;
    this.scheduleFlush();
  }

  setMapStyle(index: number): void {
    if (!this.map || !this.fetchStyle || index < 0 || index >= this.styleCandidates.length) return;
    this.ready = false;
    this.fetchStyle(this.styleCandidates[index].url).then((style) => {
      this.map.setStyle(style);
    });
    this._setActiveStyleIndexSig(index);
    try {
      localStorage.setItem("ocap-maplibre-style", String(index));
    } catch {
      // Storage unavailable — style choice just won't persist across reloads
    }
  }

  // ==================== Events ====================

  on(event: RendererEvent, cb: (...args: any[]) => void): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(cb);
  }

  off(event: RendererEvent, cb: (...args: any[]) => void): void {
    this.listeners.get(event)?.delete(cb);
  }

  private fireEvent(event: RendererEvent, ...args: any[]): void {
    for (const cb of this.listeners.get(event) ?? []) cb(...args);
  }

  getControls(): RendererControls {
    return { container: this.map?.getContainer(), supports3D: true };
  }
}
