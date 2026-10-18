/**
 * cTab LOGI events from a legacy JSON recording.
 *
 * cTab sends two OCAP custom events, `cTab_logiRequestSent` and
 * `cTab_logiStatusChanged`, each with a readable message and a JSON
 * extraData object. Depending on the recorder version the event lands in
 * the recording in one of three shapes:
 *
 *   [frame, name, {…data…}]            data object in the message slot
 *   [frame, name, "LOGI: …", {…data…}]  extraData as fourth value (object or JSON string)
 *   [frame, name, "LOGI: …"]            only the text (today's OCAP2 extension
 *                                       drops extraData in its JSON export)
 *
 * The first two give full detail; the last is parsed from the text, which
 * carries no request id and no item list.
 */

import type { EventDef } from "../../data/types";

export const LOGI_REQUEST_SENT = "cTab_logiRequestSent";
export const LOGI_STATUS_CHANGED = "cTab_logiStatusChanged";
export const LOGI_EVENT_NAMES: ReadonlySet<string> = new Set([LOGI_REQUEST_SENT, LOGI_STATUS_CHANGED]);

/** extraData schema versions this parser understands. */
const SUPPORTED_SCHEMA = 1;

export const LOGI_STATUSES = ["REQUESTED", "IN PROCESS", "IN DELIVERY", "DELIVERED", "ABORTED"] as const;

export interface LogiPerson {
  uid: string;
  name: string;
  callsign: string;
}

export interface LogiItem {
  class: string;
  name: string;
  qty: number;
  type: string;
  vehicleClass?: string;
  preset?: string;
}

interface LogiCommon {
  /** Missing when parsed from the text only. */
  requestId?: string;
  requestName: string;
  gameTime?: string;
  sender: LogiPerson;
  recipients: LogiPerson[];
}

export interface LogiRequestData extends LogiCommon {
  kind: "request";
  forwarded: boolean;
  /** -1 when unknown. */
  itemCount: number;
  itemsTruncated: boolean;
  items: LogiItem[];
}

export interface LogiStatusData extends LogiCommon {
  kind: "status";
  oldStatus?: string;
  newStatus: string;
  changedBy: LogiPerson;
}

export type LogiData = LogiRequestData | LogiStatusData;

/** Decoded LOGI event, handed from the decoder to the engine. */
export interface LogiEventDef {
  frameNum: number;
  type: typeof LOGI_REQUEST_SENT | typeof LOGI_STATUS_CHANGED;
  /** Line for the Events tab. */
  message: string;
  /** True when built from the JSON data, false when parsed from the text. */
  detailed: boolean;
  logi: LogiData;
}

/** Convert a raw JSON event array; null when it is not a (valid) LOGI event. */
export function parseLogiEvent(raw: unknown[]): LogiEventDef | null {
  if (!Array.isArray(raw) || raw.length < 3) return null;
  const frameNum = Number(raw[0]);
  const name = raw[1];
  if (typeof name !== "string" || !LOGI_EVENT_NAMES.has(name) || !Number.isFinite(frameNum)) return null;
  const type = name as LogiEventDef["type"];

  const text = typeof raw[2] === "string" ? raw[2] : "";
  const json = asObject(raw[3]) ?? asObject(raw[2]);

  if (json) {
    if (json.schema !== undefined && json.schema !== SUPPORTED_SCHEMA) return null;
    const logi = type === LOGI_REQUEST_SENT ? requestFromJson(json) : statusFromJson(json);
    return { frameNum, type, message: text || describe(logi), detailed: true, logi };
  }

  const logi = type === LOGI_REQUEST_SENT ? requestFromText(text) : statusFromText(text);
  if (!logi) return null;
  return { frameNum, type, message: text, detailed: false, logi };
}

/** JSON decoder hook: a LOGI event def, or null for every other unknown event. */
export function convertLogiEvent(raw: unknown[]): EventDef | null {
  return parseLogiEvent(raw) as unknown as EventDef | null;
}

// ─── JSON ───

function asObject(v: unknown): Record<string, unknown> | null {
  if (typeof v === "string") {
    const s = v.trim();
    if (!s.startsWith("{")) return null;
    try {
      v = JSON.parse(s);
    } catch {
      return null;
    }
  }
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

function person(v: unknown): LogiPerson {
  const o = asObject(v) ?? {};
  return { uid: str(o.uid), name: str(o.name), callsign: str(o.callsign) };
}

const persons = (v: unknown): LogiPerson[] => (Array.isArray(v) ? v.map(person) : []);

function common(o: Record<string, unknown>): LogiCommon {
  return {
    requestId: o.requestId != null && o.requestId !== "" ? str(o.requestId) : undefined,
    requestName: str(o.requestName),
    gameTime: o.gameTime != null ? str(o.gameTime) : undefined,
    sender: person(o.sender),
    recipients: persons(o.recipients),
  };
}

function item(v: unknown): LogiItem {
  const o = asObject(v) ?? {};
  const it: LogiItem = { class: str(o.class), name: str(o.name), qty: Number(o.qty) || 0, type: str(o.type) };
  if (o.vehicleClass != null) it.vehicleClass = str(o.vehicleClass);
  if (o.preset != null) it.preset = str(o.preset);
  return it;
}

function requestFromJson(o: Record<string, unknown>): LogiRequestData {
  const items = Array.isArray(o.items) ? o.items.map(item) : [];
  return {
    kind: "request",
    ...common(o),
    forwarded: o.forwarded === true,
    itemCount: typeof o.itemCount === "number" ? o.itemCount : items.length,
    itemsTruncated: o.itemsTruncated === true,
    items,
  };
}

function statusFromJson(o: Record<string, unknown>): LogiStatusData {
  return {
    kind: "status",
    ...common(o),
    oldStatus: o.oldStatus != null ? str(o.oldStatus) : undefined,
    newStatus: str(o.newStatus),
    changedBy: person(o.changedBy),
  };
}

// ─── Text fallback ───

// LOGI: <Callsign> (<Name>) sent|forwarded request "<Name|unnamed>" to <Callsigns> (<n> entries)
const REQUEST_RE = /^LOGI:\s*(.+?)\s+\((.*)\)\s+(sent|forwarded)\s+request\s+"(.*)"\s+to\s+(.*?)\s*\((\d+)\s+entr(?:y|ies)\)\s*$/;
// LOGI: <Callsign> (<Name>) set request "<Name|unnamed>" from <Sender callsign> to <Status>
const STATUS_RE = /^LOGI:\s*(.+?)\s+\((.*)\)\s+set\s+request\s+"(.*)"\s+from\s+(.*)\s+to\s+([A-Z][A-Z _]*?)\s*$/;

const textPerson = (callsign: string, name = ""): LogiPerson => ({ uid: "", name: name.trim(), callsign: callsign.trim() });
const requestName = (s: string): string => (s === "unnamed" ? "" : s);

function requestFromText(text: string): LogiRequestData | null {
  const m = REQUEST_RE.exec(text);
  if (!m) return null;
  const recipients = m[5].split(",").map((c) => c.trim()).filter(Boolean).map((c) => textPerson(c));
  return {
    kind: "request",
    requestName: requestName(m[4]),
    sender: textPerson(m[1], m[2]),
    recipients,
    forwarded: m[3] === "forwarded",
    itemCount: Number(m[6]),
    itemsTruncated: false,
    items: [],
  };
}

function statusFromText(text: string): LogiStatusData | null {
  const m = STATUS_RE.exec(text);
  if (!m) return null;
  const changedBy = textPerson(m[1], m[2]);
  return {
    kind: "status",
    requestName: requestName(m[3]),
    sender: textPerson(m[4]),
    recipients: [],
    newStatus: m[5],
    changedBy,
  };
}

// ─── Display ───

const who = (p: LogiPerson): string => (p.name ? `${p.callsign || "?"} (${p.name})` : p.callsign || "?");

/** Same wording as cTab's own message, for data that came without one. */
export function describe(d: LogiData): string {
  const name = d.requestName || "unnamed";
  if (d.kind === "request") {
    const to = d.recipients.map((r) => r.callsign || r.name).join(", ");
    return `LOGI: ${who(d.sender)} ${d.forwarded ? "forwarded" : "sent"} request "${name}" to ${to} (${d.itemCount} entries)`;
  }
  return `LOGI: ${who(d.changedBy)} set request "${name}" from ${d.sender.callsign || "?"} to ${d.newStatus}`;
}
