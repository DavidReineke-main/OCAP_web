/** True when the page was opened with `?renderer=3d`. */
export function is3DRequested(): boolean {
  return new URLSearchParams(window.location.search).get("renderer") === "3d";
}
