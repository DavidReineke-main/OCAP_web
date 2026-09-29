import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
  plugins: [solidPlugin()],
  base: "./",
  server: {
    proxy: {
      // Target 127.0.0.1 explicitly, not "localhost": on macOS, "localhost"
      // often resolves to ::1 first, and the default backend bind
      // (127.0.0.1, IPv4-only) doesn't cover that. On many Macs the IPv6
      // side of port 5000 is squatted by AirPlay Receiver (ControlCenter),
      // which then silently swallows every proxied API request.
      "/api/v1/maptool/events": {
        target: "http://127.0.0.1:5000",
        // SSE needs no timeout and no buffering
        timeout: 0,
        proxyTimeout: 0,
        headers: { "X-Forwarded-Host": "localhost:5173" },
      },
      "/api": {
        target: "http://127.0.0.1:5000",
        // Pass the browser's Host so Steam callback URLs point back here
        headers: { "X-Forwarded-Host": "localhost:5173" },
      },
      "/data": "http://127.0.0.1:5000",
      "/file": "http://127.0.0.1:5000",
      "/images": "http://127.0.0.1:5000",
    },
  },
  build: {
    target: "es2020",
    outDir: "../internal/frontend/dist",
    emptyOutDir: true,
  },
});
