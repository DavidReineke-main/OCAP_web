import { createMemo, createSignal, For, Show } from "solid-js";
import type { JSX } from "solid-js";
import { useEngine } from "../../hooks/useEngine";
import { useI18n } from "../../hooks/useLocale";
import { formatElapsedTime } from "../../playback/time";
import { ChevronDownIcon, ChevronRightIcon, ClockIcon } from "../../components/Icons";
import type { IconProps } from "../../components/Icons";
import panelStyles from "../../pages/recording-playback/components/SidePanel.module.css";
import { LogiEvent } from "./logiEvent";
import type { LogiPerson } from "./parse";
import { buildOrders, isClosedStatus, orderStartFrame, statusAt, statusColor, type LogiOrder } from "./orders";
import styles from "./LogiTab.module.css";

type StatusFilter = "all" | "open" | "closed";

/** Crate icon for the tab and the event rows. */
export const LogiIcon = (p: IconProps): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width={p.size ?? 16} height={p.size ?? 16}>
    <path d="M21 8l-9-5-9 5v8l9 5 9-5z" />
    <path d="M3 8l9 5 9-5" />
    <path d="M12 13v8" />
  </svg>
);

/** Icon and colour for a LOGI row in the upstream Events tab; null for other events. */
export function logiEventStyle(event: unknown): { icon: JSX.Element; color: string } | null {
  if (!(event instanceof LogiEvent)) return null;
  const status = event.logi.kind === "request" ? "REQUESTED" : event.logi.newStatus;
  return { icon: <LogiIcon size={16} />, color: statusColor(status) };
}

export function StatusPill(props: { status: string | null }): JSX.Element {
  return (
    <span class={styles.pill} style={{ color: statusColor(props.status), "border-color": statusColor(props.status) }}>
      {props.status ?? "?"}
    </span>
  );
}

const personLabel = (p: LogiPerson): string => (p.name && p.callsign ? `${p.callsign} (${p.name})` : p.callsign || p.name || "?");

export function LogiTab(): JSX.Element {
  const engine = useEngine();
  const { t } = useI18n();
  const [filterText, setFilterText] = createSignal("");
  const [statusFilter, setStatusFilter] = createSignal<StatusFilter>("all");
  const [wholeMission, setWholeMission] = createSignal(false);
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set());

  // endFrame is set after the engine has loaded the events, so reading it
  // here rebuilds the orders for every new recording.
  const orders = createMemo(() => {
    engine.endFrame();
    const events = engine.eventManager.getAll().filter((e): e is LogiEvent => e instanceof LogiEvent);
    return buildOrders(events);
  });

  const viewFrame = () => (wholeMission() ? Number.POSITIVE_INFINITY : engine.currentFrame());

  const visible = createMemo(() => {
    const frame = viewFrame();
    const text = filterText().toLowerCase();
    const f = statusFilter();
    return orders()
      .filter((o) => orderStartFrame(o) <= frame)
      .filter((o) => {
        if (f === "all") return true;
        return isClosedStatus(statusAt(o, frame)) === (f === "closed");
      })
      .filter((o) => {
        if (!text) return true;
        const hay = [
          o.requestName,
          personLabel(o.sender),
          ...o.recipients.map(personLabel),
          ...o.items.map((i) => i.name),
        ].join(" ").toLowerCase();
        return hay.includes(text);
      })
      .reverse(); // newest first, like the Events tab
  });

  const counts = createMemo(() => {
    const frame = viewFrame();
    let open = 0;
    let closed = 0;
    for (const o of orders()) {
      if (orderStartFrame(o) > frame) continue;
      if (isClosedStatus(statusAt(o, frame))) closed++;
      else open++;
    }
    return { open, closed };
  });

  const toggle = (key: string) => {
    const next = new Set(expanded());
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setExpanded(next);
  };

  const timeStr = (frame: number) => formatElapsedTime(frame, engine.captureDelayMs());

  const showPerson = (p: LogiPerson, e: MouseEvent) => {
    e.stopPropagation();
    const unit = engine.entityManager.getUnits().find((u) => (p.name && u.name === p.name));
    if (unit) engine.panToEntity(unit.id);
  };

  const PersonLink = (props: { person: LogiPerson }) => (
    <span class={styles.person} title={t("logi_show_unit")} onClick={(e) => showPerson(props.person, e)}>
      {personLabel(props.person)}
    </span>
  );

  const OrderCard = (props: { order: LogiOrder }) => {
    const o = props.order;
    const status = () => statusAt(o, viewFrame());
    const isOpen = () => expanded().has(o.key);
    return (
      <div class={styles.card} style={{ "border-left-color": statusColor(status()) }}>
        <button class={styles.cardHeader} onClick={() => toggle(o.key)}>
          <span class={styles.chevron}>
            {isOpen() ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
          </span>
          <span class={styles.cardTitle}>
            <span class={styles.requestName}>{o.requestName || t("logi_unnamed")}</span>
            <StatusPill status={status()} />
          </span>
          <span class={panelStyles.eventTime}>
            <ClockIcon size={14} />
            {timeStr(orderStartFrame(o))}
          </span>
        </button>
        <div class={styles.route}>
          <PersonLink person={o.sender} />
          <span class={styles.arrow}>{"→"}</span>
          <For each={o.recipients}>
            {(r, i) => (
              <>
                <Show when={i() > 0}>, </Show>
                <PersonLink person={r} />
              </>
            )}
          </For>
          <Show when={o.itemCount >= 0}>
            <span class={styles.count}>
              · {o.itemCount} {t("logi_entries")}
            </span>
          </Show>
        </div>

        <Show when={isOpen()}>
          <div class={styles.details}>
            <Show
              when={o.items.length > 0}
              fallback={<div class={styles.hint}>{t("logi_text_only")}</div>}
            >
              <ul class={styles.items}>
                <For each={o.items}>
                  {(it) => (
                    <li class={styles.item} title={it.class}>
                      <span class={styles.qty}>{it.qty}×</span>
                      <span class={styles.itemName}>{it.name || it.class}</span>
                      <Show when={it.type && it.type !== "ITEM"}>
                        <span class={styles.tag}>{it.type}{it.preset ? ` · ${it.preset}` : ""}</span>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
              <Show when={o.itemsTruncated}>
                <div class={styles.hint}>{t("logi_items_truncated")}</div>
              </Show>
            </Show>

            <div class={styles.sectionLabel}>{t("logi_history")}</div>
            <For each={o.history}>
              {(h) => (
                <button
                  class={styles.historyRow}
                  classList={{ [styles.future]: h.frame > engine.currentFrame() }}
                  onClick={() => engine.seekTo(h.frame)}
                >
                  <span class={styles.historyTime}>{timeStr(h.frame)}</span>
                  <Show when={h.kind === "status"} fallback={<span class={styles.historyKind}>{t(h.kind === "sent" ? "logi_sent" : "logi_forwarded")}</span>}>
                    <StatusPill status={h.status} />
                  </Show>
                  <span class={styles.historyBy}>{personLabel(h.by)}</span>
                  <Show when={h.gameTime}>
                    <span class={styles.gameTime}>{h.gameTime}</span>
                  </Show>
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
    );
  };

  const filterButton = (id: StatusFilter, label: string, count?: number) => (
    <button
      class={styles.chip}
      classList={{ [styles.chipActive]: statusFilter() === id }}
      onClick={() => setStatusFilter(id)}
    >
      {label}
      <Show when={count !== undefined}> {count}</Show>
    </button>
  );

  return (
    <>
      <div class={panelStyles.filterBar}>
        <input
          class={panelStyles.filterInput}
          type="text"
          placeholder={t("logi_search")}
          value={filterText()}
          onInput={(e) => setFilterText(e.currentTarget.value)}
        />
      </div>
      <div class={styles.toolbar}>
        {filterButton("all", t("logi_filter_all"))}
        {filterButton("open", t("logi_filter_open"), counts().open)}
        {filterButton("closed", t("logi_filter_closed"), counts().closed)}
        <label class={styles.whole}>
          <input type="checkbox" checked={wholeMission()} onChange={(e) => setWholeMission(e.currentTarget.checked)} />
          {t("logi_whole_mission")}
        </label>
      </div>
      <div class={panelStyles.tabContent}>
        <Show when={visible().length > 0} fallback={<div class={panelStyles.placeholder}>{t("logi_none")}</div>}>
          <For each={visible()}>{(o) => <OrderCard order={o} />}</For>
        </Show>
      </div>
    </>
  );
}
