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

## Files

- `index.ts`: entry point (`create3DRendererIfRequested`, `Map3DToggle`)
- `maplibre3dRenderer.ts`: `MapRenderer` implementation on native MapLibre GL with terrain
- `entity3dLayer.ts`: custom layer for airborne units (altitude, drop lines)
- `heightmap.ts`: heightmap discovery (tile base first, then local maps folder)
- `Map3DToggle.tsx`: 2D/3D switch button, and its tooltip is the camera legend in 3D
- `i18n.ts`, `mode.ts`: translations, `?renderer=3d` check

## Staying in sync with upstream

```bash
git remote add upstream https://github.com/OCAP2/web.git   # once
git fetch upstream
git merge upstream/main
```
