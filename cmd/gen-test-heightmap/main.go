// One-off dev utility: generates a synthetic (not real) DEM for "altis" and
// runs it through the project's own heightmap pipeline, so the 3D map view
// has something with real elevation to render for local testing. Delete
// after use unless kept intentionally as a reusable test-data tool.
package main

import (
	"context"
	"fmt"
	"log"
	"math"
	"math/rand"
	"os"
	"path/filepath"

	"github.com/OCAP2/web/internal/maptool"
)

const worldSize = 30720 // Altis, meters

func main() {
	tools := maptool.DetectTools()
	if _, ok := tools.FindTool("gdal_translate"); !ok {
		log.Fatal("gdal_translate not found on PATH")
	}
	if _, ok := tools.FindTool("pmtiles"); !ok {
		log.Fatal("pmtiles not found on PATH")
	}

	grid := syntheticDEM(256, 256, worldSize)

	tempDir, err := os.MkdirTemp("", "gen-test-heightmap-*")
	if err != nil {
		log.Fatalf("temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	outputDir := filepath.Join("maps", "altis")
	if err := os.MkdirAll(filepath.Join(outputDir, "tiles"), 0o755); err != nil {
		log.Fatalf("mkdir: %v", err)
	}

	job := &maptool.Job{
		WorldName: "altis",
		OutputDir: outputDir,
		TempDir:   tempDir,
		SubDirs:   true,
		WorldSize: worldSize,
		DEMPath:   "synthetic", // NewGenerateHeightmapStage only checks this is non-empty
		DEMGrid:   grid,
	}

	stage := maptool.NewGenerateHeightmapStage(tools)
	if err := stage.Run(context.Background(), job); err != nil {
		log.Fatalf("generate heightmap: %v", err)
	}

	// Deliberately no map.json here: the frontend's getWorldConfig() probes
	// for a local heightmap.pmtiles independently of (and in addition to)
	// wherever basemap imagery resolves from (local/CDN) — see
	// ApiClient.enrichWithLocalHeightmap in ui/src/data/apiClient.ts. A local
	// map.json would make the "local" tier win outright and skip the CDN
	// imagery fallback entirely, even though it has no real tile imagery.
	fmt.Println("Wrote", filepath.Join(outputDir, "tiles", "heightmap.pmtiles"))
}

// syntheticDEM builds a made-up (not real Altis) elevation grid: a few
// overlapping sine waves at different scales plus jitter, so it has visible
// hills/ridges rather than being flat or pure noise-static. Not meant to be
// accurate — only to exercise 3D terrain rendering.
func syntheticDEM(cols, rows, worldSize int) *maptool.DEMGrid {
	rng := rand.New(rand.NewSource(42))
	data := make([]float32, cols*rows)

	for row := 0; row < rows; row++ {
		for col := 0; col < cols; col++ {
			x := float64(col) / float64(cols)
			y := float64(row) / float64(rows)

			h := 0.0
			h += 220 * math.Sin(x*2*math.Pi*1.3+0.5) * math.Cos(y*2*math.Pi*0.8)
			h += 120 * math.Sin(x*2*math.Pi*3.1+1.7) * math.Sin(y*2*math.Pi*2.4)
			h += 60 * math.Cos(x*2*math.Pi*5.7) * math.Cos(y*2*math.Pi*4.9+0.3)
			h += (rng.Float64() - 0.5) * 40

			// Push above sea level overall and clamp so nothing goes deeply negative.
			h += 180
			if h < 0 {
				h = 0
			}

			data[row*cols+col] = float32(h)
		}
	}

	return &maptool.DEMGrid{
		Cols:      cols,
		Rows:      rows,
		XllCorner: 0,
		YllCorner: 0,
		CellSize:  float64(worldSize) / float64(cols),
		NoData:    -9999,
		Data:      data,
	}
}
