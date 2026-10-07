// Package terrainrgb writes a DEM as Mapbox Terrain-RGB heightmap.pmtiles
// for the 3D view (fork extension, see ui/src/extensions/map3d).
//
// It mirrors maptool's heightmap stage with one difference: tiles and
// overviews are resampled with nearest neighbour. Terrain-RGB spreads one
// height over three bytes (R*65536 + G*256 + B in 0.1 m steps), so any
// interpolating resampler mixes the bytes independently and invents heights
// wherever B wraps (every 25.6 m). maptool's LANCZOS tiles and "average"
// overviews put ~1-8% of archie's pixels more than 5 m off, up to 30 m.
// MapLibre interpolates between DEM samples itself when rendering.
package terrainrgb

import (
	"context"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"log"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/OCAP2/web/internal/maptool"
)

// metersPerDegree matches maptool and ui/src/utils/coordinates.ts.
const metersPerDegree = 111320

// Zoom range of the base tiles; overviews add the levels below.
const (
	minZoom = 11
	maxZoom = 14
)

// WritePMTiles encodes grid (row 0 = south) as Terrain-RGB and writes it to
// outPath as PMTiles, using tempDir for intermediates.
func WritePMTiles(ctx context.Context, tools maptool.ToolSet, grid *maptool.DEMGrid, worldSize int, tempDir, outPath string) error {
	gdalTranslate, ok := tools.FindTool("gdal_translate")
	if !ok {
		return fmt.Errorf("gdal_translate not found")
	}
	pmtilesBin, ok := tools.FindTool("pmtiles")
	if !ok {
		return fmt.Errorf("pmtiles not found")
	}

	pngPath := filepath.Join(tempDir, "heightmap-rgb.png")
	if err := encode(grid, pngPath); err != nil {
		return fmt.Errorf("encode terrain-RGB: %w", err)
	}
	vrtPath := filepath.Join(tempDir, "heightmap.vrt")
	if err := writeVRT(vrtPath, pngPath, grid.Cols, grid.Rows, worldSize); err != nil {
		return fmt.Errorf("write VRT: %w", err)
	}

	mbtiles := filepath.Join(tempDir, "heightmap.mbtiles")
	if err := maptool.RasterToMBTiles(ctx, gdalTranslate.Path, vrtPath, mbtiles,
		"heightmap", minZoom, maxZoom, "PNG", "NEAREST"); err != nil {
		return err
	}
	if gdalAddo, ok := tools.FindTool("gdaladdo"); ok {
		out, err := exec.CommandContext(ctx, gdalAddo.Path, "-r", "nearest", mbtiles, "2", "4", "8", "16").CombinedOutput()
		if err != nil {
			log.Printf("WARNING: gdaladdo failed: %v\n%s", err, out)
		}
	}
	if err := os.MkdirAll(filepath.Dir(outPath), 0o755); err != nil {
		return err
	}
	return maptool.MBTilesToPMTiles(ctx, pmtilesBin.Path, mbtiles, outPath)
}

// encode writes grid as a Terrain-RGB PNG with row 0 = north.
func encode(grid *maptool.DEMGrid, path string) error {
	img := image.NewNRGBA(image.Rect(0, 0, grid.Cols, grid.Rows))
	for row := 0; row < grid.Rows; row++ {
		src := grid.Data[(grid.Rows-1-row)*grid.Cols : (grid.Rows-row)*grid.Cols]
		for col, h := range src {
			img.SetNRGBA(col, row, Encode(float64(h)))
		}
	}
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return png.Encode(f, img)
}

// Encode returns the Terrain-RGB colour of a height in metres
// (height = -10000 + (R*65536 + G*256 + B) * 0.1), rounded to 0.1 m.
func Encode(height float64) color.NRGBA {
	v := int((height+10000)*10 + 0.5)
	if v < 0 {
		v = 0
	}
	if v > 0xFFFFFF {
		v = 0xFFFFFF
	}
	return color.NRGBA{R: byte(v >> 16), G: byte(v >> 8), B: byte(v), A: 255}
}

// writeVRT georeferences the PNG over [0, worldSize] metres in both axes,
// expressed in degrees the same way the 3D view places Arma coordinates.
func writeVRT(vrtPath, pngPath string, cols, rows, worldSize int) error {
	deg := float64(worldSize) / metersPerDegree
	src, err := filepath.Rel(filepath.Dir(vrtPath), pngPath)
	if err != nil {
		src = pngPath
	}
	f, err := os.Create(vrtPath)
	if err != nil {
		return err
	}
	defer f.Close()
	fmt.Fprintf(f, "<VRTDataset rasterXSize=\"%d\" rasterYSize=\"%d\">\n", cols, rows)
	fmt.Fprintf(f, "  <SRS>EPSG:4326</SRS>\n")
	fmt.Fprintf(f, "  <GeoTransform>0, %.15e, 0, %.15e, 0, -%.15e</GeoTransform>\n", deg/float64(cols), deg, deg/float64(rows))
	for i, name := range []string{"Red", "Green", "Blue"} {
		fmt.Fprintf(f, "  <VRTRasterBand dataType=\"Byte\" band=\"%d\">\n", i+1)
		fmt.Fprintf(f, "    <ColorInterp>%s</ColorInterp>\n", name)
		fmt.Fprintf(f, "    <SimpleSource>\n")
		fmt.Fprintf(f, "      <SourceFilename relativeToVRT=\"1\">%s</SourceFilename>\n", src)
		fmt.Fprintf(f, "      <SourceBand>%d</SourceBand>\n", i+1)
		fmt.Fprintf(f, "      <SrcRect xOff=\"0\" yOff=\"0\" xSize=\"%d\" ySize=\"%d\" />\n", cols, rows)
		fmt.Fprintf(f, "      <DstRect xOff=\"0\" yOff=\"0\" xSize=\"%d\" ySize=\"%d\" />\n", cols, rows)
		fmt.Fprintf(f, "    </SimpleSource>\n")
		fmt.Fprintf(f, "  </VRTRasterBand>\n")
	}
	fmt.Fprintf(f, "</VRTDataset>\n")
	return nil
}
