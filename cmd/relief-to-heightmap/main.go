// Command relief-to-heightmap estimates a heightmap for a world that only has
// rendered raster maps (legacy gdal2tiles output) by inverting its
// <world>_colorRelief.tif — a hypsometric tint rendered with the maptool
// color ramp, shaded by a hillshade and overlaid with map features.
//
// Hillshading scales brightness but keeps the hue, so each pixel's
// chromaticity is matched against the ramp to recover its elevation.
// Low-saturation pixels (roads, buildings, labels) and pixels far off the
// ramp are dropped and filled from their neighbours. The result is an
// estimate: good for relief shape and coastlines, but absolute land heights
// can be off where vegetation overlays shift the hue. The real DEM from a
// grad_meh export is always better when available.
//
// Usage:
//
//	relief-to-heightmap -maps maps -world archie [-res 2048] [-keep-seabed]
//
// Writes <maps>/<world>/tiles/heightmap.pmtiles, which the 3D view picks up.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"sort"

	"github.com/OCAP2/web/internal/maptool"
	"github.com/OCAP2/web/internal/terrainrgb"
)

// rampStop mirrors colorReliefGuide in internal/maptool/colorrelief.go.
type rampStop struct {
	elev    float64
	r, g, b float64
}

// Only the part of the ramp that is actually hue-distinct: below -500 m it
// is near-black, above 450 m it fades to grey/white like roads and labels.
var ramp = []rampStop{
	{-500, 0, 0, 10},
	{-300, 0, 0, 20},
	{-200, 0, 0, 70},
	{-100, 0, 0, 130},
	{-50, 0, 0, 205},
	{0, 0, 255, 255},
	{0.1, 57, 151, 105},
	{50, 117, 194, 93},
	{150, 230, 230, 128},
	{250, 202, 158, 75},
	{350, 214, 187, 98},
	{450, 185, 154, 100},
}

type sample struct {
	elev   float64
	c0, c1 float64 // chromaticity r/(r+g+b), g/(r+g+b)
}

func chroma(r, g, b float64) (float64, float64, bool) {
	s := r + g + b
	if s == 0 {
		return 0, 0, false
	}
	return r / s, g / s, true
}

func buildSamples() []sample {
	var out []sample
	for i := 0; i+1 < len(ramp); i++ {
		a, b := ramp[i], ramp[i+1]
		for t := 0.0; t < 1; t += 0.005 {
			c0, c1, ok := chroma(a.r+(b.r-a.r)*t, a.g+(b.g-a.g)*t, a.b+(b.b-a.b)*t)
			if ok {
				out = append(out, sample{a.elev + (b.elev-a.elev)*t, c0, c1})
			}
		}
	}
	return out
}

// Pixels whose hue is further than this from the ramp are treated as map
// features rather than terrain.
const maxChromaDist = 0.03

// Pixels with less saturation than this are grey/white features.
const minSaturation = 0.2

// Pixels need at least this red share to count as clearly land for the
// shoreline calibration; water has ~0, land ~0.2-0.4.
const minLandRed = 0.25

// Lowest land stop of the ramp and its colour; shoreline land is calibrated to it.
const landStart = 0.1

var landStartRGB = [3]float64{57, 151, 105}

// Shoreline calibration samples land between these distances (in metres)
// from the water: past the surf/beach blend, still at about sea level.
const (
	shoreNearM = 25
	shoreFarM  = 50
)

func main() {
	mapsDir := flag.String("maps", "maps", "maps directory")
	world := flag.String("world", "", "world name (folder under -maps)")
	res := flag.Int("res", 2048, "heightmap grid size in cells per side")
	preview := flag.String("preview", "", "also write the estimated elevation as a greyscale PGM image to this path")
	keepSeabed := flag.Bool("keep-seabed", false, "keep negative (underwater) elevations instead of flattening the sea to 0 m")
	flag.Parse()
	if *world == "" {
		log.Fatal("-world is required")
	}

	tools := maptool.DetectTools()
	gdalTranslate, ok := tools.FindTool("gdal_translate")
	if !ok {
		log.Fatal("gdal_translate not found on PATH")
	}
	if _, ok := tools.FindTool("pmtiles"); !ok {
		log.Fatal("pmtiles not found on PATH")
	}

	worldDir := filepath.Join(*mapsDir, *world)
	worldSize := readWorldSize(filepath.Join(worldDir, "map.json"))
	reliefPath := filepath.Join(worldDir, *world+"_colorRelief.tif")

	tempDir, err := os.MkdirTemp("", "relief-to-heightmap-*")
	if err != nil {
		log.Fatalf("temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Sample at twice the target resolution (nearest, so feature pixels stay
	// separable from terrain), then reduce 2x2 blocks by median.
	src := *res * 2
	rawPath := filepath.Join(tempDir, "relief.bin")
	if out, err := exec.Command(gdalTranslate.Path,
		"-q", "-of", "ENVI", "-co", "INTERLEAVE=BIP", "-r", "nearest",
		"-outsize", fmt.Sprint(src), fmt.Sprint(src), reliefPath, rawPath).CombinedOutput(); err != nil {
		log.Fatalf("gdal_translate: %v\n%s", err, out)
	}
	raw, err := os.ReadFile(rawPath)
	if err != nil {
		log.Fatalf("read raster: %v", err)
	}
	if len(raw) < src*src*3 {
		log.Fatalf("unexpected raster size %d (want RGB %dx%d)", len(raw), src, src)
	}

	metresPerPx := float64(worldSize) / float64(src)
	fine := invert(raw, src, buildSamples(),
		int(math.Ceil(shoreNearM/metresPerPx)), int(math.Ceil(shoreFarM/metresPerPx)))
	grid := reduceMedian(fine, src, 2)
	dropOutliers(grid)
	valid := fillHoles(grid, *res)
	grid = medianFilter(grid, *res, 2)
	grid = boxBlur(grid, *res, 1)
	if !*keepSeabed {
		for i, v := range grid {
			if v < 0 {
				grid[i] = 0
			}
		}
	}

	if *preview != "" {
		if err := writePGM(*preview, grid, *res); err != nil {
			log.Fatalf("write preview: %v", err)
		}
	}

	// Image row 0 is north; DEMGrid row 0 is south.
	data := make([]float32, len(grid))
	for row := 0; row < *res; row++ {
		copy(data[row**res:(row+1)**res], toF32(grid[(*res-1-row)**res:(*res-row)**res]))
	}
	minE, maxE := minMax(grid)
	log.Printf("estimated elevation %.0f..%.0f m, %.1f%% of cells read directly from colour", minE, maxE, 100*valid)

	out := filepath.Join(worldDir, "tiles", "heightmap.pmtiles")
	dem := &maptool.DEMGrid{
		Cols:     *res,
		Rows:     *res,
		CellSize: float64(worldSize) / float64(*res),
		NoData:   -9999,
		Data:     data,
	}
	if err := terrainrgb.WritePMTiles(context.Background(), tools, dem, worldSize, tempDir, out); err != nil {
		log.Fatalf("generate heightmap: %v", err)
	}
	fmt.Println("Wrote", out)
}

// writePGM writes the grid (row 0 = north) as an 8-bit greyscale image,
// stretched from its lowest to its highest elevation.
func writePGM(path string, g []float64, n int) error {
	lo, hi := minMax(g)
	span := math.Max(hi-lo, 1)
	img := make([]byte, len(g))
	for i, v := range g {
		img[i] = byte(math.Round((v - lo) / span * 255))
	}
	header := fmt.Sprintf("P5\n%d %d\n255\n", n, n)
	return os.WriteFile(path, append([]byte(header), img...), 0o644)
}

func readWorldSize(path string) int {
	data, err := os.ReadFile(path)
	if err != nil {
		log.Fatalf("read map.json: %v", err)
	}
	var meta struct {
		WorldSize int `json:"worldSize"`
	}
	if err := json.Unmarshal(data, &meta); err != nil || meta.WorldSize <= 0 {
		log.Fatalf("map.json has no worldSize")
	}
	return meta.WorldSize
}

// invert maps every RGB pixel to an elevation, or NaN for feature pixels.
//
// Water is pure ramp colour and is read directly. Land has the topo map's
// land fill blended over the ramp, which shifts its hue (on archie, coastal
// land reads ~(0.31, 0.43) instead of the ramp's (0.18, 0.48) at 0.1 m). The
// shift is estimated from land pixels touching water, which sit at ~0 m, and
// removed from all land before matching. This keeps relative relief and puts
// the coast at 0 m; heights inland are a conservative estimate.
func invert(raw []byte, size int, samples []sample, shoreNear, shoreFar int) []float64 {
	// The 0 -> 0.1 m segment is only gdaldem's cyan-to-green transition at
	// the waterline; land proper starts at the 0.1 m green.
	var sea, land []sample
	for _, s := range samples {
		if s.elev <= 0 {
			sea = append(sea, s)
		} else if s.elev >= landStart {
			land = append(land, s)
		}
	}

	out := make([]float64, size*size)
	isSea := make([]bool, size*size)
	isLand := make([]bool, size*size)
	clearLand := make([]bool, size*size)
	for i := range out {
		r, g, b := float64(raw[3*i]), float64(raw[3*i+1]), float64(raw[3*i+2])
		if !saturated(r, g, b) {
			out[i] = math.NaN()
			continue
		}
		c0, c1, _ := chroma(r, g, b)
		if e, ok := match(c0, c1, sea); ok {
			out[i], isSea[i] = e, true
		} else {
			out[i], isLand[i] = math.NaN(), true
		}
		// Water is ~0 red; pale blends of water and beach sit in between.
		clearLand[i] = isLand[i] && c0 >= minLandRed
	}

	// Land hue just inland of the shoreline, where the true elevation is
	// ~0 m. The first couple of pixels are skipped: they blend surf and beach.
	seaAt := func(x, y, dist int) bool {
		for _, d := range [][2]int{{dist, 0}, {-dist, 0}, {0, dist}, {0, -dist}} {
			if isSea[(y+d[1])*size+x+d[0]] {
				return true
			}
		}
		return false
	}
	var shore0, shore1 []float64
	for y := shoreFar; y < size-shoreFar; y++ {
		for x := shoreFar; x < size-shoreFar; x++ {
			i := y*size + x
			if clearLand[i] && seaAt(x, y, shoreFar) && !seaAt(x, y, 1) && !seaAt(x, y, shoreNear) {
				r, g, b := float64(raw[3*i]), float64(raw[3*i+1]), float64(raw[3*i+2])
				c0, c1, _ := chroma(r, g, b)
				shore0, shore1 = append(shore0, c0), append(shore1, c1)
			}
		}
	}
	d0, d1 := 0.0, 0.0
	if len(shore0) > 0 {
		base0, base1, _ := chroma(landStartRGB[0], landStartRGB[1], landStartRGB[2])
		d0, d1 = base0-median(shore0), base1-median(shore1)
		log.Printf("land hue shift from %d shoreline pixels: (%+.3f, %+.3f)", len(shore0), d0, d1)
	} else {
		log.Printf("no shoreline found — reading land colours without correction")
	}

	cache := map[[3]byte]float64{}
	for i := range out {
		if !isLand[i] {
			continue
		}
		px := [3]byte{raw[3*i], raw[3*i+1], raw[3*i+2]}
		if v, ok := cache[px]; ok {
			out[i] = v
			continue
		}
		c0, c1, _ := chroma(float64(px[0]), float64(px[1]), float64(px[2]))
		v := math.NaN()
		if e, ok := match(c0+d0, c1+d1, land); ok {
			v = e
		}
		cache[px] = v
		out[i] = v
	}
	return out
}

func saturated(r, g, b float64) bool {
	hi := math.Max(r, math.Max(g, b))
	lo := math.Min(r, math.Min(g, b))
	return hi >= 20 && (hi-lo)/hi >= minSaturation
}

// match returns the elevation of the closest ramp sample, if close enough.
func match(c0, c1 float64, samples []sample) (float64, bool) {
	best, elev := math.Inf(1), 0.0
	for _, s := range samples {
		if d := math.Hypot(c0-s.c0, c1-s.c1); d < best {
			best, elev = d, s.elev
		}
	}
	return elev, best <= maxChromaDist
}

// reduceMedian shrinks the grid by factor, taking the median of valid values.
func reduceMedian(in []float64, size, factor int) []float64 {
	n := size / factor
	out := make([]float64, n*n)
	buf := make([]float64, 0, factor*factor)
	for y := 0; y < n; y++ {
		for x := 0; x < n; x++ {
			buf = buf[:0]
			for dy := 0; dy < factor; dy++ {
				for dx := 0; dx < factor; dx++ {
					if v := in[(y*factor+dy)*size+x*factor+dx]; !math.IsNaN(v) {
						buf = append(buf, v)
					}
				}
			}
			out[y*n+x] = median(buf)
		}
	}
	return out
}

// fillHoles replaces NaN cells with the mean of their valid neighbours,
// growing inward until the grid is full. Returns the share of cells that
// were valid before filling.
func fillHoles(g []float64, n int) float64 {
	validCount := 0
	for _, v := range g {
		if !math.IsNaN(v) {
			validCount++
		}
	}
	if validCount == 0 {
		log.Fatal("no pixel matched the colour ramp — is this really a colorRelief image?")
	}
	for {
		next := append([]float64(nil), g...)
		changed := false
		for y := 0; y < n; y++ {
			for x := 0; x < n; x++ {
				if !math.IsNaN(g[y*n+x]) {
					continue
				}
				sum, cnt := 0.0, 0
				for dy := -1; dy <= 1; dy++ {
					for dx := -1; dx <= 1; dx++ {
						xx, yy := x+dx, y+dy
						if xx < 0 || yy < 0 || xx >= n || yy >= n {
							continue
						}
						if v := g[yy*n+xx]; !math.IsNaN(v) {
							sum += v
							cnt++
						}
					}
				}
				if cnt > 0 {
					next[y*n+x] = sum / float64(cnt)
					changed = true
				}
			}
		}
		copy(g, next)
		if !changed {
			break
		}
	}
	return float64(validCount) / float64(len(g))
}

func medianFilter(g []float64, n, radius int) []float64 {
	out := make([]float64, len(g))
	buf := make([]float64, 0, (2*radius+1)*(2*radius+1))
	for y := 0; y < n; y++ {
		for x := 0; x < n; x++ {
			buf = buf[:0]
			for dy := -radius; dy <= radius; dy++ {
				for dx := -radius; dx <= radius; dx++ {
					xx, yy := clamp(x+dx, n), clamp(y+dy, n)
					buf = append(buf, g[yy*n+xx])
				}
			}
			out[y*n+x] = median(buf)
		}
	}
	return out
}

// dropOutliers discards land estimates far above the bulk of the terrain.
// Small patches of roofs or markings that happen to match the ramp's browns
// would otherwise become needle-like peaks hundreds of metres high; real
// mountains cover too much area to fall this far outside the distribution.
func dropOutliers(g []float64) {
	var land []float64
	for _, v := range g {
		if v > 0 {
			land = append(land, v)
		}
	}
	if len(land) == 0 {
		return
	}
	sort.Float64s(land)
	limit := 2*land[len(land)*995/1000] + 10
	dropped := 0
	for i, v := range g {
		if v > limit {
			g[i] = math.NaN()
			dropped++
		}
	}
	log.Printf("dropped %d outlier cells above %.0f m", dropped, limit)
}

func boxBlur(g []float64, n, radius int) []float64 {
	out := make([]float64, len(g))
	for y := 0; y < n; y++ {
		for x := 0; x < n; x++ {
			sum, cnt := 0.0, 0
			for dy := -radius; dy <= radius; dy++ {
				for dx := -radius; dx <= radius; dx++ {
					sum += g[clamp(y+dy, n)*n+clamp(x+dx, n)]
					cnt++
				}
			}
			out[y*n+x] = sum / float64(cnt)
		}
	}
	return out
}

func median(v []float64) float64 {
	if len(v) == 0 {
		return math.NaN()
	}
	sort.Float64s(v)
	return v[len(v)/2]
}

func clamp(i, n int) int {
	if i < 0 {
		return 0
	}
	if i >= n {
		return n - 1
	}
	return i
}

func minMax(v []float64) (float64, float64) {
	lo, hi := math.Inf(1), math.Inf(-1)
	for _, x := range v {
		lo, hi = math.Min(lo, x), math.Max(hi, x)
	}
	return lo, hi
}

func toF32(v []float64) []float32 {
	out := make([]float32, len(v))
	for i, x := range v {
		out[i] = float32(x)
	}
	return out
}
