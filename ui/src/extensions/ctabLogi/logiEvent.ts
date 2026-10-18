import { GeneralMissionEvent } from "../../playback/events/generalEvent";
import { LOGI_EVENT_NAMES, type LogiData, type LogiEventDef } from "./parse";

/**
 * A cTab LOGI event in the playback engine.
 *
 * Extends GeneralMissionEvent, so the upstream Events tab, its filters,
 * its search and the timeline treat it like any mission message.
 */
export class LogiEvent extends GeneralMissionEvent {
  readonly logiType: LogiEventDef["type"];
  readonly logi: LogiData;
  readonly detailed: boolean;

  constructor(def: LogiEventDef, id: number) {
    super(def.frameNum, id, def.message);
    this.logiType = def.type;
    this.logi = def.logi;
    this.detailed = def.detailed;
  }
}

function isLogiEventDef(def: unknown): def is LogiEventDef {
  const d = def as Partial<LogiEventDef> | null;
  return !!d && typeof d.type === "string" && LOGI_EVENT_NAMES.has(d.type) && !!d.logi;
}

/** Engine hook: a LogiEvent for LOGI defs, null for everything else. */
export function createLogiGameEvent(def: unknown, id: number): LogiEvent | null {
  return isLogiEventDef(def) ? new LogiEvent(def, id) : null;
}
