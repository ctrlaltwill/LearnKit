/**
 * @file src/analytics/new-cards-per-day-chart.tsx
 * @summary Bar chart displaying the number of newly created cards per day over a
 * configurable window (7, 30, or 90 days). Uses card creation timestamps to bucket
 * counts by local day. Supports filtering by card type, deck, and group tags.
 *
 * @exports
 *   - NewCardsPerDayChart — React component rendering a daily new-cards bar chart with filter controls
 */
import {  } from "obsidian";

import * as React from "react";
import type { ChartConfiguration } from "chart.js";
import { createXAxisTicks, formatAxisLabel } from "../chart-axis-utils";
import { endTruncateClass, useAnalyticsPopoverZIndex } from "../filter-styles";
import { MS_DAY } from "../../../platform/core/constants";
import { interfaceLocaleToIntlLocale } from "../../../platform/translations/locale-registry";
import { t } from "../../../platform/translations/translator";
import { ChartJsCanvas, resolveChartColor } from "./chartjs-canvas";

function InfoIcon(props: { text: string }) {
  return (
    <span
      className="inline-flex items-center text-muted-foreground"
      data-tooltip={props.text}
      data-tooltip-position="right"
    >
      <svg
        className="svg-icon lucide-info"
        xmlns="http://www.w3.org/2000/svg"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4" />
        <path d="M12 8h.01" />
      </svg>
    </span>
  );
}

const BAR_COLOR = "var(--chart-accent-2)";

const MAX_SELECTIONS = 3;

type CardLike = {
  createdAt?: number;
  type?: string;
  deckId?: string;
  deckPath?: string;
  sourceNotePath?: string;
  groups?: string[] | null;
  tags?: string[] | null;
  groupPath?: string | null;
};

type Datum = {
  label: string;
  date: string;
  created: number;
};

type AxisDatum = Datum & {
  dayIndex: number;
};

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`bc svg-icon learnkit-ana-chevron${open ? " is-open" : ""}`}
      xmlns="http://www.w3.org/2000/svg"
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="6 4 14 12 6 20" />
    </svg>
  );
}

function formatFilterPath(raw: string, maxChars = 30) {
  let text = String(raw ?? "").trim();
  const lower = text.toLowerCase();
  if (lower.endsWith(".md")) text = text.slice(0, -3);
  text = text.replace(/\s*\/\s*/g, " / ");
  if (text.length <= maxChars) return text;
  const tail = text.slice(-maxChars).trimStart();
  return `...${tail}`;
}

const TYPE_LABELS: Record<string, string> = {
  all: "All cards",
  basic: "Basic",
  "reversed-child": "Basic (Reversed)",
  "cloze-child": "Cloze",
  "io-child": "Image occlusion",
  mcq: "Multiple choice",
};

function normalizeCardType(raw: string) {
  const t = String(raw ?? "").toLowerCase();
  if (t === "cloze") return "cloze-child";
  if (t === "io") return "io-child";
  if (t === "reversed") return "reversed-child";
  return t;
}

function getCardDeck(card: CardLike): string | null {
  const raw = card.deckPath ?? card.deckId ?? card.sourceNotePath;
  const deck = String(raw ?? "").trim();
  return deck ? deck : null;
}

function getCardGroups(card: CardLike): string[] {
  if (Array.isArray(card.groups)) return card.groups.filter(Boolean);
  if (Array.isArray(card.tags)) return card.tags.filter(Boolean);
  const single = String(card.groupPath ?? "").trim();
  return single ? [single] : [];
}

function makeDatePartsFormatter(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function getDateParts(ts: number, formatter: Intl.DateTimeFormat) {
  const parts = formatter.formatToParts(new Date(ts));
  const map = new Map(parts.map((p) => [p.type, p.value]));
  const year = Number(map.get("year"));
  const month = Number(map.get("month"));
  const day = Number(map.get("day"));
  return { year, month, day };
}

function localDayIndex(ts: number, formatter: Intl.DateTimeFormat) {
  const { year, month, day } = getDateParts(ts, formatter);
  const utc = Date.UTC(year, month - 1, day);
  return Math.floor(utc / MS_DAY);
}

function formatDayLabel(dayIndex: number, timeZone: string, locale: string) {
  const date = new Date(dayIndex * MS_DAY);
  return date.toLocaleDateString(locale, { timeZone, month: "short", day: "numeric" });
}

function formatDayTitle(dayIndex: number, timeZone: string, locale: string) {
  const date = new Date(dayIndex * MS_DAY);
  return date.toLocaleDateString(locale, { timeZone, weekday: "short", month: "short", day: "numeric" });
}

function normalizeMatchText(raw: string) {
  return String(raw ?? "")
    .trim()
    .replace(/\.md$/i, "")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function rankFilterMatches(items: string[], query: string, limit = 5) {
  const q = query.trim().toLowerCase();
  if (!q) return items.slice(0, limit);
  const scored = items
    .map((item) => {
      const norm = normalizeMatchText(item);
      const segments = norm
        .split("/")
        .map((part) => part.trim())
        .filter(Boolean);
      let bestScore: number | null = null;
      for (const seg of segments) {
        if (seg === q) bestScore = bestScore === null ? 0 : Math.min(bestScore, 0);
        else if (seg.startsWith(q)) bestScore = bestScore === null ? 1 : Math.min(bestScore, 1);
        else if (seg.includes(q)) bestScore = bestScore === null ? 2 : Math.min(bestScore, 2);
      }
      if (bestScore === null && norm.includes(q)) bestScore = 3;
      if (bestScore === null) return null;
      const index = Math.max(0, norm.indexOf(q));
      return { item, score: bestScore, depth: segments.length, index, len: norm.length };
    })
    .filter(Boolean) as Array<{ item: string; score: number; depth: number; index: number; len: number }>;

  return scored
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      if (a.depth !== b.depth) return a.depth - b.depth;
      if (a.index !== b.index) return a.index - b.index;
      if (a.len !== b.len) return a.len - b.len;
      return a.item.localeCompare(b.item);
    })
    .map((entry) => entry.item)
    .slice(0, limit);
}

function roundUpToNearest10(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.ceil(value / 10) * 10;
}

function buildYAxisTicks(maxValue: number): number[] {
  if (maxValue <= 0) return [0];
  const mid = Math.round(maxValue / 2);
  const ticks = [0, mid, maxValue];
  return ticks.filter((value, index, array) => index === 0 || value !== array[index - 1]);
}

export function NewCardsPerDayChart(props: {
  cards: CardLike[];
  timezone?: string;
  days?: number;
  enableAnimations?: boolean;
  locale?: string;
}) {
  const tz = props.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const formatter = React.useMemo(() => makeDatePartsFormatter(tz), [tz]);
  const intlLocale = React.useMemo(() => interfaceLocaleToIntlLocale(props.locale), [props.locale]);
  const tx = React.useMemo(() => (token: string, fallback: string, vars?: Record<string, string | number>) => t(props.locale, token, fallback, vars), [props.locale]);
  const [durationDays, setDurationDays] = React.useState(props.days ?? 30);
  const [open, setOpen] = React.useState(false);
  const [selectedType, setSelectedType] = React.useState<string>("all");
  const [deckQuery, setDeckQuery] = React.useState("");
  const [groupQuery, setGroupQuery] = React.useState("");
  const [selectedDecks, setSelectedDecks] = React.useState<string[]>([]);
  const [selectedGroups, setSelectedGroups] = React.useState<string[]>([]);
  const [durationOpen, setDurationOpen] = React.useState(false);
  const [cardTypeOpen, setCardTypeOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const popoverRef = React.useRef<HTMLDivElement | null>(null);
  useAnalyticsPopoverZIndex(open, wrapRef);
  const toggleDurationOpen = () => setDurationOpen((prev) => !prev);
  const toggleCardTypeOpen = () => setCardTypeOpen((prev) => !prev);

  const onDurationKey = (ev: React.KeyboardEvent) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      toggleDurationOpen();
    }
  };

  const onCardTypeKey = (ev: React.KeyboardEvent) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      toggleCardTypeOpen();
    }
  };

  React.useEffect(() => {
    setDurationDays(props.days ?? 30);
  }, [props.days]);

  React.useEffect(() => {
    if (!open) return;
    const onDocClick = (ev: MouseEvent) => {
      const target = ev.target as Node | null;
      if (!target || !wrapRef.current) return;
      if (!wrapRef.current.contains(target)) setOpen(false);
    };
    activeDocument.addEventListener("mousedown", onDocClick, true);
    return () => activeDocument.removeEventListener("mousedown", onDocClick, true);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const place = () => {
      const popover = popoverRef.current;
      if (!popover) return;
      popover.classList.remove("learnkit-ana-popover-left", "learnkit-ana-popover-left");
      popover.classList.add("learnkit-ana-popover-right", "learnkit-ana-popover-right");
    };
    place();
    window.addEventListener("resize", place, true);
    return () => window.removeEventListener("resize", place, true);
  }, [open]);

  const todayIndex = React.useMemo(() => localDayIndex(Date.now(), formatter), [formatter]);
  const startIndex = todayIndex - (durationDays - 1);

  const availableTypes = React.useMemo(() => ["all", "basic", "reversed-child", "cloze-child", "io-child", "mcq"], []);

  const allDecks = React.useMemo(() => {
    const decks = new Set<string>();
    for (const card of props.cards ?? []) {
      const deck = getCardDeck(card);
      if (deck) decks.add(deck);
    }
    return Array.from(decks).sort((a, b) => a.localeCompare(b));
  }, [props.cards]);

  const allGroups = React.useMemo(() => {
    const groups = new Set<string>();
    for (const card of props.cards ?? []) {
      for (const group of getCardGroups(card)) groups.add(group);
    }
    return Array.from(groups).sort((a, b) => a.localeCompare(b));
  }, [props.cards]);

  const matchedDecks = React.useMemo(() => rankFilterMatches(allDecks, deckQuery, 5), [allDecks, deckQuery]);
  const matchedGroups = React.useMemo(() => rankFilterMatches(allGroups, groupQuery, 5), [allGroups, groupQuery]);

  const typeCounts = React.useMemo(() => {
    const PARENT_TYPES = new Set(["cloze", "reversed", "io", "io-parent", "io_parent", "ioparent"]);
    const counts = new Map<string, number>();
    for (const type of availableTypes) counts.set(type, 0);
    for (const card of props.cards ?? []) {
      const raw = String(card?.type ?? "").toLowerCase();
      if (PARENT_TYPES.has(raw)) continue;
      const t = normalizeCardType(card?.type ?? "");
      if (!t) continue;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    if (counts.has("all")) {
      const total = Array.from(counts.entries())
        .filter(([key]) => key !== "all")
        .reduce((sum, [, value]) => sum + (value ?? 0), 0);
      counts.set("all", total);
    }
    return counts;
  }, [availableTypes, props.cards]);

  const resetFilters = () => {
    setSelectedType("all");
    setSelectedDecks([]);
    setSelectedGroups([]);
    setDeckQuery("");
    setGroupQuery("");
    setDurationDays(props.days ?? 30);
    setDurationOpen(false);
    setCardTypeOpen(false);
    setOpen(false);
  };

  const toggleDeck = (deck: string) => {
    setSelectedDecks((prev) => {
      if (prev.includes(deck)) return prev.filter((item) => item !== deck);
      if (prev.length >= MAX_SELECTIONS) return prev;
      return [...prev, deck];
    });
  };

  const toggleGroup = (group: string) => {
    setSelectedGroups((prev) => {
      if (prev.includes(group)) return prev.filter((item) => item !== group);
      if (prev.length >= MAX_SELECTIONS) return prev;
      return [...prev, group];
    });
  };

  const data = React.useMemo<AxisDatum[]>(() => {
    const rows: AxisDatum[] = [];
    const map = new Map<number, AxisDatum>();

    for (let i = 0; i < durationDays; i += 1) {
      const dayIndex = startIndex + i;
      const base = {
        label: formatDayLabel(dayIndex, tz, intlLocale),
        date: formatDayTitle(dayIndex, tz, intlLocale),
        created: 0,
      };
      const datum: AxisDatum = { ...base, dayIndex };
      rows.push(datum);
      map.set(dayIndex, datum);
    }

    const PARENT_TYPES = new Set(["cloze", "reversed", "io", "io-parent", "io_parent", "ioparent"]);

    for (const card of props.cards ?? []) {
      const raw = String(card?.type ?? "").toLowerCase();
      if (PARENT_TYPES.has(raw)) continue;
      const t = normalizeCardType(card?.type ?? "");
      if (selectedType !== "all" && t !== selectedType) continue;

      if (selectedDecks.length) {
        const deck = getCardDeck(card);
        if (!deck || !selectedDecks.includes(deck)) continue;
      }

      if (selectedGroups.length) {
        const groups = getCardGroups(card);
        const hasGroup = selectedGroups.some((group) => groups.includes(group));
        if (!hasGroup) continue;
      }

      const createdAt = Number(card?.createdAt);
      if (!Number.isFinite(createdAt)) continue;

      const dayIndex = localDayIndex(createdAt, formatter);
      if (dayIndex < startIndex || dayIndex > todayIndex) continue;

      const row = map.get(dayIndex);
      if (row) row.created += 1;
    }

    return rows;
  }, [props.cards, formatter, tz, durationDays, startIndex, todayIndex, selectedType, selectedDecks, selectedGroups, intlLocale]);

  const durationOptions = React.useMemo(() => [7, 30, 90], []);

  const xTicks = React.useMemo(() => createXAxisTicks(startIndex, todayIndex, todayIndex), [startIndex, todayIndex]);

  const xTickFormatter = (value: number) =>
    formatAxisLabel(
      value,
      todayIndex,
      (dayIndex) => formatDayLabel(dayIndex, tz, intlLocale),
      tx("ui.view.coach.readiness.today", "Today"),
    );

  const yMax = React.useMemo(() => {
    const maxValue = data.reduce((max, row) => Math.max(max, row.created), 0);
    return roundUpToNearest10(maxValue);
  }, [data]);

  const yTicks = React.useMemo(() => buildYAxisTicks(yMax), [yMax]);

  const chartConfig = React.useMemo<ChartConfiguration<"bar">>(() => {
    const axisColor = resolveChartColor("var(--border)");
    const tickColor = resolveChartColor("var(--text-muted)");
    const xTickSet = new Set(xTicks);

    return {
      type: "bar",
      data: {
        datasets: [
          {
            label: tx("ui.analytics.newCards.subtitle", "Cards created per day"),
            data: data.map((row) => ({ x: row.dayIndex, y: row.created })),
            parsing: false,
            backgroundColor: resolveChartColor(BAR_COLOR),
            borderWidth: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: props.enableAnimations ?? true,
        scales: {
          x: {
            type: "linear",
            min: startIndex,
            max: todayIndex,
            border: { color: axisColor },
            grid: { display: false },
            ticks: {
              color: tickColor,
              font: { size: 12 },
              callback: (value) => {
                const day = Number(value);
                if (!xTickSet.has(day)) return "";
                return xTickFormatter(day);
              },
            },
          },
          y: {
            type: "linear",
            min: 0,
            max: yMax,
            border: { color: axisColor },
            grid: { display: false },
            ticks: {
              color: tickColor,
              font: { size: 12 },
              callback: (value) => String(value),
            },
            afterBuildTicks: (axis) => {
              axis.ticks = yTicks.map((value) => ({ value }));
            },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => {
                const day = Number(items[0]?.parsed.x ?? todayIndex);
                return formatDayTitle(day, tz, intlLocale);
              },
              label: (item) => tx("ui.analytics.newCards.tooltipCreated", "Created: {count}", { count: Number(item.parsed.y ?? 0) }),
            },
          },
        },
      },
    };
  }, [data, intlLocale, props.enableAnimations, startIndex, todayIndex, tx, tz, xTickFormatter, xTicks, yMax, yTicks]);

  return (
    <div className="card learnkit-ana-card h-full overflow-visible p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1">
            <div className="font-semibold lk-home-section-title">{tx("ui.analytics.newCards.title", "New cards added")}</div>
            <InfoIcon text={tx("ui.analytics.newCards.info", "Number of new cards created each day over the selected window.")} />
          </div>
          <div className="text-xs text-muted-foreground">{tx("ui.analytics.newCards.subtitle", "Cards created per day")}</div>
        </div>

        <div ref={wrapRef} className="relative inline-flex">
          <button
            type="button"
            id="learnkit-newcards-filter-trigger"
            className="learnkit-btn-toolbar learnkit-btn-filter h-7 px-2 text-sm inline-flex items-center gap-2"
            aria-haspopup="listbox"
            aria-expanded={open ? "true" : "false"}
            onClick={() => setOpen((prev) => !prev)}
          >
            <svg
              className="svg-icon lucide-filter text-foreground"
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="22 3 2 3 10 12.5 10 19 14 21 14 12.5 22 3" />
            </svg>
            <span>{tx("ui.analytics.chart.filter", "Filter")}</span>
          </button>

          {open ? (
            <div
              id="learnkit-newcards-filter-popover"
              aria-hidden="false"
              ref={popoverRef}
              className="rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-0 flex flex-col learnkit-ana-popover learnkit-ana-popover-sm learnkit-ana-popover-left"
            >
              <div className="p-1">
                <div
                  className="flex items-center justify-between text-sm text-muted-foreground px-2 py-1 cursor-pointer outline-none focus-visible:shadow-outline"
                  role="button"
                  tabIndex={0}
                  aria-expanded={durationOpen ? "true" : "false"}
                  onClick={toggleDurationOpen}
                  onKeyDown={onDurationKey}
                >
                  <span>{tx("ui.analytics.chart.duration", "Duration")}</span>
                  <ChevronIcon open={durationOpen} />
                </div>

                {durationOpen ? (
                  <div role="menu" aria-orientation="vertical" className="flex flex-col">
                    {durationOptions.map((opt) => {
                      const selected = durationDays === opt;
                      return (
                        <div
                          key={opt}
                          role="menuitemradio"
                          aria-checked={selected ? "true" : "false"}
                          tabIndex={0}
                          className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                          onClick={() => setDurationDays(opt)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setDurationDays(opt);
                            }
                          }}
                        >
                          <div className="size-4 flex items-center justify-center">
                            <div
                              className="size-2 rounded-full bg-foreground invisible group-aria-checked:visible"
                              aria-hidden="true"
                            />
                          </div>
                          <span>{tx("ui.analytics.chart.days", "{opt} days", { opt })}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                <div className="h-px bg-border my-1" role="separator" />

                <div
                  className="flex items-center justify-between text-sm text-muted-foreground px-2 py-1 cursor-pointer outline-none focus-visible:shadow-outline"
                  role="button"
                  tabIndex={0}
                  aria-expanded={cardTypeOpen ? "true" : "false"}
                  onClick={toggleCardTypeOpen}
                  onKeyDown={onCardTypeKey}
                >
                  <span>{tx("ui.analytics.chart.cardType", "Card type")}</span>
                  <ChevronIcon open={cardTypeOpen} />
                </div>

                {cardTypeOpen ? (
                  <div
                    role="menu"
                    id="learnkit-newcards-filter-listbox"
                    aria-orientation="vertical"
                    data-tooltip="New cards filter"
                    className="flex flex-col"
                  >
                    {availableTypes.map((type) => {
                      const label = tx(`ui.analytics.chart.type.${type}`, TYPE_LABELS[type] ?? type);
                      const selected = selectedType === type;
                      const count = typeCounts.get(type) ?? 0;
                      return (
                        <div
                          key={type}
                          role="menuitemradio"
                          aria-checked={selected ? "true" : "false"}
                          tabIndex={0}
                          className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                          onClick={() => setSelectedType(type)}
                        >
                          <div className="size-4 flex items-center justify-center">
                            <div
                              className="size-2 rounded-full bg-foreground invisible group-aria-checked:visible"
                              aria-hidden="true"
                            />
                          </div>
                          <span className="flex items-center gap-2">
                            <span>{label}</span>
                            <span className="text-muted-foreground">{`(${count})`}</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                <div className="h-px bg-border my-1" role="separator" />

                <div className="text-sm text-muted-foreground px-2 py-1">{tx("ui.analytics.chart.decks", "Decks")}</div>
                <div className="px-2 pb-2">
                  <input
                    type="text"
                    placeholder={tx("ui.analytics.chart.searchDecks", "Search decks")}
                    className="input w-full text-sm learnkit-filter-search-input"
                    value={deckQuery}
                    onChange={(event) => {
                      const next = event.currentTarget.value;
                      setDeckQuery(next);
                      if (!next.trim()) setSelectedDecks([]);
                    }}
                  />
                </div>

                {deckQuery.trim().length ? (
                  <div className="px-2 pb-2">
                    <div className="flex flex-col">
                      {matchedDecks.length ? (
                        matchedDecks.map((deck) => (
                          <div
                            key={deck}
                            role="menuitem"
                            tabIndex={0}
                            className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground min-w-0"
                            onClick={() => toggleDeck(deck)}
                          >
                            <span className="size-3 rounded-full border border-muted-foreground/40 flex items-center justify-center">
                              {selectedDecks.includes(deck) ? (
                                <span className="size-1.5 rounded-full bg-foreground" />
                              ) : null}
                            </span>
                            <span className={`bc truncate ${endTruncateClass}`}>
                              {formatFilterPath(deck)}
                            </span>
                          </div>
                        ))
                      ) : (
                        <div className="px-2 py-1 text-sm text-muted-foreground">{tx("ui.analytics.chart.noDecksFound", "No decks found.")}</div>
                      )}
                    </div>
                  </div>
                ) : null}

                <div className="h-px bg-border my-1" role="separator" />

                <div className="text-sm text-muted-foreground px-2 py-1">{tx("ui.analytics.chart.groups", "Groups")}</div>
                <div className="px-2 pb-2">
                  <input
                    type="text"
                    placeholder={tx("ui.analytics.chart.searchGroups", "Search groups")}
                    className="input w-full text-sm learnkit-filter-search-input"
                    value={groupQuery}
                    onChange={(event) => {
                      const next = event.currentTarget.value;
                      setGroupQuery(next);
                      if (!next.trim()) setSelectedGroups([]);
                    }}
                  />
                </div>

                {groupQuery.trim().length ? (
                  <div className="px-2 pb-2">
                    <div className="flex flex-col">
                      {matchedGroups.length ? (
                        matchedGroups.map((group) => (
                          <div
                            key={group}
                            role="menuitem"
                            tabIndex={0}
                            className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground min-w-0"
                            onClick={() => toggleGroup(group)}
                          >
                            <span className="size-3 rounded-full border border-muted-foreground/40 flex items-center justify-center">
                              {selectedGroups.includes(group) ? (
                                <span className="size-1.5 rounded-full bg-foreground" />
                              ) : null}
                            </span>
                            <span className={`bc truncate ${endTruncateClass}`}>
                              {formatFilterPath(group)}
                            </span>
                          </div>
                        ))
                      ) : (
                        <div className="px-2 py-1 text-sm text-muted-foreground">{tx("ui.analytics.chart.noGroupsFound", "No groups found.")}</div>
                      )}
                    </div>
                  </div>
                ) : null}

                <div className="h-px bg-border my-1" role="separator" />

                <div className="text-sm text-muted-foreground cursor-pointer px-2" onClick={resetFilters}>
                  {tx("ui.analytics.chart.resetFilters", "Reset filters")}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <ChartJsCanvas
        className="w-full flex-1 learnkit-analytics-chart"
        config={chartConfig}
        height={250}
        ariaLabel={tx("ui.analytics.newCards.title", "New cards added")}
      />
    </div>
  );
}
