package terrainrgb

import "testing"

func decode(h float64) float64 {
	c := Encode(h)
	return -10000 + float64(int(c.R)<<16|int(c.G)<<8|int(c.B))*0.1
}

func TestEncodeRoundTrip(t *testing.T) {
	for _, h := range []float64{0, 0.05, 25.6, 110.598, -177.59, 4000} {
		if got := decode(h); got < h-0.051 || got > h+0.051 {
			t.Errorf("Encode(%v) decodes to %v", h, got)
		}
	}
}

func TestEncodeClamps(t *testing.T) {
	if got := decode(-20000); got != -10000 {
		t.Errorf("below range decodes to %v, want -10000", got)
	}
	if c := Encode(1e9); c.R != 255 || c.G != 255 || c.B != 255 {
		t.Errorf("above range = %v, want white", c)
	}
}
