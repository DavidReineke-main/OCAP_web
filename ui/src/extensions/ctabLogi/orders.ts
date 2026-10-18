import type { LogiItem, LogiPerson } from "./parse";
import type { LogiEvent } from "./logiEvent";

export interface LogiHistoryEntry {
  frame: number;
  kind: "sent" | "forwarded" | "status";
  status: string;
  by: LogiPerson;
  gameTime?: string;
  /** Recipients of a send or forward. */
  to?: LogiPerson[];
}

/** One LOGI request with everything that happened to it, in frame order. */
export interface LogiOrder {
  key: string;
  requestId?: string;
  requestName: string;
  sender: LogiPerson;
  recipients: LogiPerson[];
  items: LogiItem[];
  /** -1 when unknown (status changes seen, but no request event). */
  itemCount: number;
  itemsTruncated: boolean;
  /** False when the order was rebuilt from message texts only. */
  detailed: boolean;
  history: LogiHistoryEntry[];
}

/**
 * Group LOGI events into orders.
 *
 * With a requestId (JSON data) events are grouped by it. Text-only events
 * have none, so a status change joins the latest earlier request with the
 * same name and sender callsign.
 */
export function buildOrders(events: readonly LogiEvent[]): LogiOrder[] {
  const sorted = [...events].sort((a, b) => a.frameNum - b.frameNum || a.id - b.id);
  const byId = new Map<string, LogiOrder>();
  const orders: LogiOrder[] = [];

  const textKey = (name: string, sender: LogiPerson) => `${name}\u0000${sender.callsign}`;
  const latestByText = new Map<string, LogiOrder>();

  for (const ev of sorted) {
    const d = ev.logi;
    let order = d.requestId ? byId.get(d.requestId) : latestByText.get(textKey(d.requestName, d.sender));
    const isNewRequest = d.kind === "request" && !d.forwarded && !d.requestId;

    if (!order || isNewRequest) {
      order = {
        key: d.requestId ?? `text-${ev.id}`,
        requestId: d.requestId,
        requestName: d.requestName,
        sender: d.sender,
        recipients: d.recipients,
        items: [],
        itemCount: -1,
        itemsTruncated: false,
        detailed: ev.detailed,
        history: [],
      };
      orders.push(order);
      if (d.requestId) byId.set(d.requestId, order);
    }
    latestByText.set(textKey(d.requestName, d.sender), order);
    if (ev.detailed) order.detailed = true;

    if (d.kind === "request") {
      if (order.itemCount < 0 || d.items.length > order.items.length) {
        order.items = d.items;
        order.itemCount = d.itemCount;
        order.itemsTruncated = d.itemsTruncated;
      }
      if (!d.forwarded) {
        order.sender = d.sender;
        order.recipients = d.recipients;
      }
      order.history.push({
        frame: ev.frameNum,
        kind: d.forwarded ? "forwarded" : "sent",
        status: "REQUESTED",
        by: d.sender,
        gameTime: d.gameTime,
        to: d.recipients,
      });
    } else {
      if (order.recipients.length === 0 && d.recipients.length > 0) order.recipients = d.recipients;
      if (!order.sender.name && d.sender.name) order.sender = d.sender;
      order.history.push({ frame: ev.frameNum, kind: "status", status: d.newStatus, by: d.changedBy, gameTime: d.gameTime });
    }
  }
  return orders;
}

/** First frame the order shows up. */
export const orderStartFrame = (o: LogiOrder): number => o.history[0]?.frame ?? 0;

/** Status at a frame, or null when the order does not exist yet. */
export function statusAt(o: LogiOrder, frame: number): string | null {
  let status: string | null = null;
  for (const h of o.history) {
    if (h.frame > frame) break;
    status = h.status;
  }
  return status;
}

export const isClosedStatus = (s: string | null): boolean => s === "DELIVERED" || s === "ABORTED";

/** Accent colour per status (CSS variables from styles/variables.css). */
export function statusColor(status: string | null): string {
  switch (status) {
    case "REQUESTED": return "var(--accent-primary)";
    case "IN PROCESS": return "var(--accent-warning)";
    case "IN DELIVERY": return "var(--accent-purple)";
    case "DELIVERED": return "var(--accent-success)";
    case "ABORTED": return "var(--accent-danger)";
    default: return "#888";
  }
}
