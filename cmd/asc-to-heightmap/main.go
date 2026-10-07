// Command asc-to-heightmap turns a world's DEM (ESRI ASCII grid, as written
// by ocap-exporter for ocap-renderterrain, or dem.asc.gz from grad_meh) into
// the tiles/heightmap.pmtiles the 3D view uses (see internal/terrainrgb for
// why this does not reuse maptool's heightmap stage). Use it for worlds rendered with
// ocap-renderterrain, which consumes the .asc but never writes a heightmap.
//
// Usage:
//
//	asc-to-heightmap -maps maps -world archie [-asc path/to/archie.asc] [-keep-seabed]
//
// The .asc defaults to <maps>/<world>/<world>.asc (or .asc.gz).
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"math"
	"os"
	"path/filepath"
	"strings"

	"github.com/OCAP2/web/internal/maptool"
	"github.com/OCAP2/web/internal/terrainrgb"
)

func main() {
	mapsDir := flag.String("maps", "maps", "maps directory")
	world := flag.String("world", "", "world name (folder under -maps)")
	ascPath := flag.String("asc", "", "DEM file (.asc or .asc.gz); default <maps>/<world>/<world>.asc[.gz]")
	keepSeabed := flag.Bool("keep-seabed", false, "keep negative (underwater) elevations instead of flattening the sea to 0 m")
	flag.Parse()
	if *world == "" {
		log.Fatal("-world is required")
	}

	tools := maptool.DetectTools()
	for _, t := range []string{"gdal_translate", "pmtiles"} {
		if _, ok := tools.FindTool(t); !ok {
			log.Fatalf("%s not found on PATH", t)
		}
	}

	worldDir := filepath.Join(*mapsDir, *world)
	path := *ascPath
	if path == "" {
		path = findASC(worldDir, *world)
	}

	grid, err := readGrid(path)
	if err != nil {
		log.Fatalf("read %s: %v", path, err)
	}

	lo, hi, flattened := math.Inf(1), math.Inf(-1), 0
	for i, v := range grid.Data {
		if float64(v) == grid.NoData {
			continue
		}
		lo, hi = math.Min(lo, float64(v)), math.Max(hi, float64(v))
		if !*keepSeabed && v < 0 {
			grid.Data[i] = 0
			flattened++
		}
	}
	log.Printf("%s: %dx%d cells of %.1f m, elevation %.1f..%.1f m", path, grid.Cols, grid.Rows, grid.CellSize, lo, hi)
	if flattened > 0 {
		log.Printf("flattened %d underwater cells to 0 m (use -keep-seabed to keep them)", flattened)
	}

	tempDir, err := os.MkdirTemp("", "asc-to-heightmap-*")
	if err != nil {
		log.Fatalf("temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	out := filepath.Join(worldDir, "tiles", "heightmap.pmtiles")
	worldSize := int(math.Round(float64(grid.Cols) * grid.CellSize))
	if err := terrainrgb.WritePMTiles(context.Background(), tools, grid, worldSize, tempDir, out); err != nil {
		log.Fatalf("generate heightmap: %v", err)
	}
	fmt.Println("Wrote", out)
}

func findASC(worldDir, world string) string {
	for _, name := range []string{world + ".asc", world + ".asc.gz", "dem.asc", "dem.asc.gz"} {
		p := filepath.Join(worldDir, name)
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	log.Fatalf("no %s.asc[.gz] or dem.asc[.gz] in %s — pass -asc", world, worldDir)
	return ""
}

func readGrid(path string) (*maptool.DEMGrid, error) {
	if strings.HasSuffix(path, ".gz") {
		return maptool.ParseASCGridGz(path)
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return maptool.ParseASCGrid(f)
}
