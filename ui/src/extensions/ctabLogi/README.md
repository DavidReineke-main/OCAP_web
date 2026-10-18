# cTab LOGI requests (fork extension)

Shows the LOGI custom events from cTab (`cTab_logiRequestSent`,
`cTab_logiStatusChanged`) in the playback:

- **Events tab:** every LOGI event as a row with a crate icon, coloured by
  status. It is a `GeneralMissionEvent`, so the "mission events" filter,
  the search and the timeline handle it like any other mission message.
- **LOGI tab** (side panel): one card per request, with its status at the
  current frame, sender → recipients, the ordered items and the status
  history. Click a history line to jump there, click a name to pan to that
  unit. Filter by open/closed or turn on "Whole mission" to see orders
  that come later in the recording.

The event format is described in the cTab doc "cTab LOGI – OCAP Events".

## Data shapes

`parse.ts` accepts all three ways a LOGI event can end up in a legacy JSON
recording:

| Shape | Detail |
|-------|--------|
| `[frame, name, {…data…}]` | full (items, request id) |
| `[frame, name, "LOGI: …", {…data…}]` (object or JSON string) | full |
| `[frame, name, "LOGI: …"]` | parsed from the text: no items, no request id |

The OCAP2 extension's JSON export (`buildGeneralEvent`) currently keeps
only `[frame, name, message]` and drops `extraData`, so recordings get the
text-only shape. If cTab sends the JSON as the message instead (the
convention `radioTransmission` uses), the export parses it into an object
and this view gets the full detail. Status changes from text-only events
join the latest earlier request with the same name and sender callsign.

Protobuf-converted recordings (`conversion.enabled`) lose the message of
unknown event types in the Go converter, so LOGI events only show for
JSON recordings.

## Hook points in upstream code

These are the only upstream lines this feature changes. Find them with
`git grep "fork: ctab-logi"`; when a merge conflicts, re-apply them by hand.

| File | Change |
|------|--------|
| `ui/src/data/decoders/jsonDecoder.ts` | import; `default:` of `convertEvent` returns `convertLogiEvent(raw)` instead of `null` |
| `ui/src/playback/engine.ts` | import; `default:` of `createGameEvent` returns `createLogiGameEvent(def, id)` |
| `ui/src/pages/recording-playback/components/SidePanel.tsx` | import; `logiTab` in the tab list; `<Match>` for `<LogiTab />` |
| `ui/src/pages/recording-playback/components/EventsTab.tsx` | import; `logiEventStyle(event)` first in `eventStyle()` |

## Files

- `parse.ts`: raw event → `LogiEventDef` (JSON or text), `convertLogiEvent` decoder hook
- `logiEvent.ts`: `LogiEvent` (extends `GeneralMissionEvent`), engine hook
- `orders.ts`: groups events into orders, status per frame, status colours
- `LogiTab.tsx`, `LogiTab.module.css`: the LOGI tab and the Events tab style
- `i18n.ts`: translations, merged into the shared table at runtime
- `index.ts`: UI entry point

## Testing

`scripts/mock-mission/generate.mjs` adds two orders to the mock mission:
"AMMO" with full JSON data and "MED" with text only.

```bash
cd scripts/mock-mission && node generate.mjs archie && ./upload.sh http://127.0.0.1:5000 <secret> archie
```
