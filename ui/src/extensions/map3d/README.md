# 3D map view (fork extension)

Everything for the 3D view lives in this folder, so upstream merges stay
conflict-free. Enable it by opening a recording with `?renderer=3d`
(or with the 2D/3D button).

## Hook points in upstream code

These are the only upstream lines this feature changes. Keep them small,
and when a merge conflicts, re-apply them by hand. Find them with
`git grep "fork: map3d"`.

| File | Change |
|------|--------|
| `ui/src/pages/recording-playback/RecordingPlayback.tsx` | import; `create3DRendererIfRequested() ?? (…)` when picking the renderer; `<Map3DToggle />` after `<MapControls />` |
| `ui/src/renderers/leaflet/canvasIcons.ts` | `export` on `ICON_SIZES`, `ICON_TYPES`, `ICON_PATHS`, `ICON_VARIANTS` |
| `ui/vitest.config.ts` | coverage exclude for `maplibre3dRenderer.ts` (needs WebGL) |

No backend changes: the renderer finds `tiles/heightmap.pmtiles` itself
(`heightmap.ts`) and enables terrain with `map.setTerrain()`. Translations
are merged into the shared table at runtime (`i18n.ts`).

## Maps

- **MapLibre worlds** (2.0 pipeline): the world's own styles, terrain from
  `tiles/heightmap.pmtiles`.
- **Legacy raster worlds** (gdal2tiles `{z}/{x}/{y}.png`, as used by the 2D
  Leaflet view): `legacyRaster.ts` serves the existing tiles to MapLibre
  through an `ocaplegacy://` protocol, switchable between topo, topoDark,
  topoRelief and colorRelief like in 2D.
- **Terrain** is always read through the `ocapdem://` protocol, which sets
  the transparent no-data area around the world to sea level (Terrain-RGB
  would read it as -10000 m and sink the map into a pit).
- **Worlds from ocap-renderterrain** need their DEM turned into a heightmap
  once; that pipeline reads `<world>.asc` but never writes one:

  ```bash
  go run ./cmd/asc-to-heightmap -maps maps -world archie   # reads maps/archie/archie.asc
  ```

  It needs `gdal_translate` and `pmtiles` on the PATH.
- **No DEM at all?** For a legacy world that has `<world>_colorRelief.tif`,
  `cmd/relief-to-heightmap` estimates one from the colours (relief shape is
  good, absolute heights are rough):

  ```bash
  go run ./cmd/relief-to-heightmap -maps maps -world archie
  ```

  It needs `gdal_translate` and `pmtiles` on the PATH.

## Files

- `index.ts`: entry point (`create3DRendererIfRequested`, `Map3DToggle`)
- `maplibre3dRenderer.ts`: `MapRenderer` implementation on native MapLibre GL with terrain
- `entity3dLayer.ts`: custom layer for airborne units (altitude, drop lines)
- `heightmap.ts`: heightmap discovery (tile base first, then local maps folder) and the no-data-filling terrain protocol
- `legacyRaster.ts`: legacy raster tiles as Web Mercator tiles
- `Map3DToggle.tsx`: 2D/3D switch button, and its tooltip is the camera legend in 3D
- `i18n.ts`, `mode.ts`: translations, `?renderer=3d` check

## Staying in sync with upstream

```bash
git remote add upstream https://github.com/OCAP2/web.git   # once
git fetch upstream
git merge upstream/main
```
