/**
 * cTab LOGI requests — fork extension entry point (UI side).
 *
 * Shows cTab's LOGI custom events (cTab_logiRequestSent,
 * cTab_logiStatusChanged) in the Events tab and as orders in a LOGI tab.
 * Upstream code only has small hook points, marked "fork: ctab-logi"
 * (see README.md). The decoder and engine hooks import parse.ts and
 * logiEvent.ts directly, so no UI code ends up in the data layer.
 */
import { LogiIcon } from "./LogiTab";
import "./i18n";

export { LogiTab, logiEventStyle } from "./LogiTab";

/** Side panel tab, appended to upstream's tab list. */
export const logiTab = { id: "logi", labelKey: "logi_tab", Icon: LogiIcon } as const;
