import type { JSX } from "solid-js";
import { useI18n } from "../../hooks/useLocale";
import { is3DRequested } from "./mode";
import styles from "./Map3DToggle.module.css";

/**
 * 2D/3D switch button. There is no live renderer hot-swap, so toggling
 * reloads the page with the `renderer=3d` query param flipped. In 3D mode
 * the tooltip doubles as the camera-controls legend.
 */
export function Map3DToggle(): JSX.Element {
  const { t } = useI18n();
  const active = is3DRequested();

  const title = () =>
    active
      ? [t("toggle_3d"), t("legend_3d_pan"), t("legend_3d_rotate"), t("legend_3d_zoom"), t("legend_3d_compass")].join("\n")
      : t("toggle_3d");

  const handleToggle = () => {
    const url = new URL(window.location.href);
    if (active) {
      url.searchParams.delete("renderer");
    } else {
      url.searchParams.set("renderer", "3d");
    }
    window.location.href = url.toString();
  };

  return (
    <button class={`${styles.toggle} ${active ? styles.active : ""}`} onClick={handleToggle} title={title()}>
      {active ? "3D" : "2D"}
    </button>
  );
}
