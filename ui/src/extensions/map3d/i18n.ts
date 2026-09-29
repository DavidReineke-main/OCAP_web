import { translations } from "../../i18n/locales";

/**
 * 3D view strings. Merged into the shared translation table at import time
 * so upstream's locales.ts stays untouched.
 */
const map3dTranslations: typeof translations = {
  toggle_3d: {
    ru: "Переключить 3D",
    en: "Toggle 3D view",
    de: "3D-Ansicht umschalten",
    cs: "Přepnout 3D zobrazení",
    it: "Attiva/disattiva vista 3D",
    fr: "Basculer la vue 3D",
    fi: "Vaihda 3D-näkymä",
    uk: "Перемкнути 3D",
  },
  legend_3d_pan: {
    ru: "Перетащить — панорама",
    en: "Drag — pan",
    de: "Ziehen — Verschieben",
    cs: "Tažení — posun",
    it: "Trascina — sposta",
    fr: "Glisser — déplacer",
    fi: "Vedä — panoroi",
    uk: "Перетягнути — панорама",
  },
  legend_3d_rotate: {
    ru: "ПКМ или Ctrl+перетащить — поворот/наклон",
    en: "Right-drag or Ctrl+drag — rotate & tilt",
    de: "Rechtsklick-Ziehen oder Strg+Ziehen — Drehen & Neigen",
    cs: "Tažení pravým tlačítkem nebo Ctrl+tažení — otočení a náklon",
    it: "Trascina col tasto destro o Ctrl+trascina — ruota e inclina",
    fr: "Glisser-droit ou Ctrl+glisser — rotation et inclinaison",
    fi: "Oikean napin veto tai Ctrl+veto — kierrä ja kallista",
    uk: "Перетягування ПКМ або Ctrl+перетягування — обертання й нахил",
  },
  legend_3d_zoom: {
    ru: "Колесо мыши — масштаб",
    en: "Scroll — zoom",
    de: "Scrollen — Zoomen",
    cs: "Kolečko myši — přiblížení",
    it: "Scorri — zoom",
    fr: "Molette — zoom",
    fi: "Vieritä — zoomaa",
    uk: "Прокрутка — масштаб",
  },
  legend_3d_compass: {
    ru: "Нажмите на компас — сброс на север",
    en: "Click compass — reset north",
    de: "Kompass klicken — Norden zurücksetzen",
    cs: "Klikněte na kompas — reset na sever",
    it: "Clicca la bussola — ripristina il nord",
    fr: "Cliquer sur la boussole — réinitialiser au nord",
    fi: "Napsauta kompassia — nollaa pohjoiseen",
    uk: "Клацнути компас — скинути на північ",
  },
};

for (const [key, entry] of Object.entries(map3dTranslations)) {
  translations[key] ??= entry;
}
