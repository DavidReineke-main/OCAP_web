import { translations } from "../../i18n/locales";

/**
 * cTab LOGI strings. Merged into the shared translation table at import
 * time so upstream's locales.ts stays untouched. Status names (REQUESTED,
 * IN PROCESS, …) stay as cTab shows them in game.
 */
const logiTranslations: typeof translations = {
  logi_tab: {
    ru: "LOGI", en: "LOGI", de: "LOGI", cs: "LOGI", it: "LOGI", fr: "LOGI", fi: "LOGI", uk: "LOGI",
  },
  logi_none: {
    ru: "Нет заявок LOGI",
    en: "No LOGI requests yet",
    de: "Noch keine LOGI-Anfragen",
    cs: "Zatím žádné požadavky LOGI",
    it: "Nessuna richiesta LOGI",
    fr: "Aucune demande LOGI",
    fi: "Ei LOGI-pyyntöjä",
    uk: "Немає заявок LOGI",
  },
  logi_search: {
    ru: "Поиск заявок...",
    en: "Search requests...",
    de: "Anfragen suchen...",
    cs: "Hledat požadavky...",
    it: "Cerca richieste...",
    fr: "Rechercher des demandes...",
    fi: "Hae pyyntöjä...",
    uk: "Пошук заявок...",
  },
  logi_filter_all: {
    ru: "Все", en: "All", de: "Alle", cs: "Vše", it: "Tutte", fr: "Toutes", fi: "Kaikki", uk: "Усі",
  },
  logi_filter_open: {
    ru: "Открытые", en: "Open", de: "Offen", cs: "Otevřené", it: "Aperte", fr: "Ouvertes", fi: "Avoimet", uk: "Відкриті",
  },
  logi_filter_closed: {
    ru: "Закрытые", en: "Closed", de: "Erledigt", cs: "Uzavřené", it: "Chiuse", fr: "Clôturées", fi: "Suljetut", uk: "Закриті",
  },
  logi_whole_mission: {
    ru: "Вся миссия",
    en: "Whole mission",
    de: "Ganze Mission",
    cs: "Celá mise",
    it: "Intera missione",
    fr: "Mission entière",
    fi: "Koko tehtävä",
    uk: "Уся місія",
  },
  logi_unnamed: {
    ru: "без названия", en: "unnamed", de: "ohne Namen", cs: "bez názvu", it: "senza nome", fr: "sans nom", fi: "nimetön", uk: "без назви",
  },
  logi_entries: {
    ru: "позиций", en: "entries", de: "Positionen", cs: "položek", it: "voci", fr: "entrées", fi: "riviä", uk: "позицій",
  },
  logi_items_truncated: {
    ru: "показаны первые 50",
    en: "first 50 shown",
    de: "erste 50 angezeigt",
    cs: "zobrazeno prvních 50",
    it: "prime 50 mostrate",
    fr: "50 premières affichées",
    fi: "50 ensimmäistä näytetään",
    uk: "показано перші 50",
  },
  logi_text_only: {
    ru: "Позиции не записаны (только текст события)",
    en: "Items not recorded (event text only)",
    de: "Positionen nicht aufgezeichnet (nur Event-Text)",
    cs: "Položky nezaznamenány (pouze text události)",
    it: "Voci non registrate (solo testo dell'evento)",
    fr: "Entrées non enregistrées (texte de l'événement seulement)",
    fi: "Rivejä ei tallennettu (vain tapahtuman teksti)",
    uk: "Позиції не записано (лише текст події)",
  },
  logi_history: {
    ru: "История", en: "History", de: "Verlauf", cs: "Historie", it: "Cronologia", fr: "Historique", fi: "Historia", uk: "Історія",
  },
  logi_sent: {
    ru: "отправлено", en: "sent", de: "gesendet", cs: "odesláno", it: "inviata", fr: "envoyée", fi: "lähetetty", uk: "надіслано",
  },
  logi_forwarded: {
    ru: "переслано", en: "forwarded", de: "weitergeleitet", cs: "přeposláno", it: "inoltrata", fr: "transférée", fi: "välitetty", uk: "переслано",
  },
  logi_show_unit: {
    ru: "Показать на карте",
    en: "Show on map",
    de: "Auf der Karte zeigen",
    cs: "Zobrazit na mapě",
    it: "Mostra sulla mappa",
    fr: "Afficher sur la carte",
    fi: "Näytä kartalla",
    uk: "Показати на мапі",
  },
};

for (const [key, entry] of Object.entries(logiTranslations)) {
  translations[key] ??= entry;
}
