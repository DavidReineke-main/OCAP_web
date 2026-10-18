import { describe, it, expect } from "vitest";
import { describe as describeLogi, parseLogiEvent, type LogiEventDef } from "../parse";
import { createLogiGameEvent, LogiEvent } from "../logiEvent";
import { buildOrders, statusAt } from "../orders";
import { GeneralMissionEvent } from "../../../playback/events/generalEvent";

const smith = { uid: "765611980", name: "J. Smith", callsign: "1-1" };
const brown = { uid: "765611981", name: "K. Brown", callsign: "CQMS" };

const requestData = {
  schema: 1, missionTime: 1834.2, gameTime: "14:05",
  requestId: "765611980184213-4821", requestName: "AMMO",
  forwarded: false, status: "REQUESTED",
  sender: smith, recipients: [brown],
  itemCount: 2, itemsTruncated: false,
  items: [
    { class: "rhs_mag_30Rnd_556x45_M855A1_Stanag", name: "STANAG 30rnd M855A1", qty: 20, type: "ITEM" },
    { class: "4IB_M1126_LV_WD|FAC", name: "Stryker LV + FAC", qty: 1, type: "VEHICLE", vehicleClass: "4IB_M1126_LV_WD", preset: "FAC" },
  ],
};
const statusData = {
  schema: 1, missionTime: 2410.7, gameTime: "14:15",
  requestId: "765611980184213-4821", requestName: "AMMO",
  oldStatus: "REQUESTED", newStatus: "IN PROCESS",
  changedBy: brown, sender: smith, recipients: [brown],
};
const requestText = 'LOGI: 1-1 (J. Smith) sent request "AMMO" to CQMS, 2-1 (2 entries)';
const statusText = 'LOGI: CQMS (K. Brown) set request "AMMO" from 1-1 to IN PROCESS';

const toEvents = (defs: (LogiEventDef | null)[]) =>
  defs.map((d, i) => createLogiGameEvent(d, i)).filter((e): e is LogiEvent => e !== null);

describe("parseLogiEvent", () => {
  it("reads the data object from the message slot", () => {
    const def = parseLogiEvent([10, "cTab_logiRequestSent", requestData])!;
    expect(def.detailed).toBe(true);
    expect(def.logi).toMatchObject({ kind: "request", requestId: "765611980184213-4821", itemCount: 2 });
    expect(def.message).toBe('LOGI: 1-1 (J. Smith) sent request "AMMO" to CQMS (2 entries)');
  });

  it("reads extraData as fourth value, also as JSON string, and keeps cTab's text", () => {
    const def = parseLogiEvent([20, "cTab_logiStatusChanged", statusText, JSON.stringify(statusData)])!;
    expect(def.detailed).toBe(true);
    expect(def.message).toBe(statusText);
    expect(def.logi).toMatchObject({ kind: "status", newStatus: "IN PROCESS", changedBy: brown });
  });

  it("falls back to the message text", () => {
    const req = parseLogiEvent([10, "cTab_logiRequestSent", requestText])!;
    expect(req.detailed).toBe(false);
    expect(req.logi).toMatchObject({
      kind: "request", requestName: "AMMO", forwarded: false, itemCount: 2,
      sender: { callsign: "1-1", name: "J. Smith" },
    });
    expect(req.logi.recipients.map((r) => r.callsign)).toEqual(["CQMS", "2-1"]);

    const st = parseLogiEvent([20, "cTab_logiStatusChanged", statusText])!;
    expect(st.logi).toMatchObject({
      kind: "status", newStatus: "IN PROCESS", sender: { callsign: "1-1" },
      changedBy: { callsign: "CQMS", name: "K. Brown" },
    });
  });

  it("parses forwarded, unnamed and single-entry requests", () => {
    const def = parseLogiEvent([5, "cTab_logiRequestSent", 'LOGI: CQMS (K. Brown) forwarded request "unnamed" to S4 (1 entry)'])!;
    expect(def.logi).toMatchObject({ forwarded: true, requestName: "", itemCount: 1 });
  });

  it("rejects other events, unknown schemas and unreadable text", () => {
    expect(parseLogiEvent([1, "generalEvent", "Recording started."])).toBeNull();
    expect(parseLogiEvent([1, "cTab_logiRequestSent", { ...requestData, schema: 2 }])).toBeNull();
    expect(parseLogiEvent([1, "cTab_logiRequestSent", "something else"])).toBeNull();
  });

  it("describe() matches cTab's status wording", () => {
    const def = parseLogiEvent([20, "cTab_logiStatusChanged", statusData])!;
    expect(describeLogi(def.logi)).toBe(statusText);
  });
});

describe("LogiEvent", () => {
  it("is a GeneralMissionEvent so the Events tab shows it", () => {
    const ev = createLogiGameEvent(parseLogiEvent([10, "cTab_logiRequestSent", requestText]), 7)!;
    expect(ev).toBeInstanceOf(GeneralMissionEvent);
    expect(ev.message).toBe(requestText);
    expect(createLogiGameEvent({ frameNum: 1, type: "generalEvent", message: "x" }, 1)).toBeNull();
  });
});

describe("buildOrders", () => {
  it("groups by requestId and tracks the status per frame", () => {
    const events = toEvents([
      parseLogiEvent([30, "cTab_logiStatusChanged", { ...statusData, oldStatus: "IN PROCESS", newStatus: "DELIVERED" }]),
      parseLogiEvent([10, "cTab_logiRequestSent", requestData]),
      parseLogiEvent([20, "cTab_logiStatusChanged", statusData]),
    ]);
    const [order, ...rest] = buildOrders(events);
    expect(rest).toHaveLength(0);
    expect(order.items).toHaveLength(2);
    expect(order.history.map((h) => h.status)).toEqual(["REQUESTED", "IN PROCESS", "DELIVERED"]);
    expect(statusAt(order, 5)).toBeNull();
    expect(statusAt(order, 25)).toBe("IN PROCESS");
    expect(statusAt(order, 99)).toBe("DELIVERED");
  });

  it("matches text-only status changes to the latest request with the same name and sender", () => {
    const events = toEvents([
      parseLogiEvent([10, "cTab_logiRequestSent", requestText]),
      parseLogiEvent([40, "cTab_logiRequestSent", requestText]),
      parseLogiEvent([50, "cTab_logiStatusChanged", statusText]),
    ]);
    const orders = buildOrders(events);
    expect(orders).toHaveLength(2);
    expect(orders[0].history).toHaveLength(1);
    expect(orders[1].history.map((h) => h.status)).toEqual(["REQUESTED", "IN PROCESS"]);
    expect(orders[1].itemCount).toBe(2);
    expect(orders[1].detailed).toBe(false);
  });

  it("keeps a status change without a known request as its own order", () => {
    const [order] = buildOrders(toEvents([parseLogiEvent([50, "cTab_logiStatusChanged", statusText])]));
    expect(order.itemCount).toBe(-1);
    expect(statusAt(order, 50)).toBe("IN PROCESS");
  });
});
