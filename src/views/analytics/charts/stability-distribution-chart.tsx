/**
 * @file src/analytics/stability-distribution-chart.tsx
 * @summary Area chart showing the distribution of cards by their FSRS stability
 * value (expected retention interval in days). Cards are bucketed into non-linear
 * intervals and plotted on a square-root-scaled x-axis so that both short- and
 * long-stability cards are visible. Supports filtering by card type, deck, and
 * group tags.
 *
 * @exports
 *   - StabilityDistributionChart — React component rendering a stability distribution area chart with filter controls
 */
import {  } from "obsidian";

import * as React from "react";
import type { ChartConfiguration } from "chart.js";
import { endTruncateClass, useAnalyticsPopoverZIndex } from "../filter-styles";
import type { CardState } from "../../../platform/types/scheduler";
import { t } from "../../../platform/translations/translator";
import { ChartJsCanvas, makeVerticalGradient, resolveChartColor, resolveChartColorWithAlpha } from "./chartjs-canvas";

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

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`svg-icon learnkit-ana-chevron${open ? " is-open" : ""}`}
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

function formatFilterPath(raw: string, maxChars = 40) {
  let text = String(raw ?? "").trim();
  const lower = text.toLowerCase();
  if (lower.endsWith(".md")) text = text.slice(0, -3);
  text = text.replace(/\s*\/\s*/g, " / ");
  if (text.length <= maxChars) return text;
  const tail = text.slice(-maxChars).trimStart();
  return `...${tail}`;
}

type StabilityDistributionChartProps = {
  cards: Array<{ id: string; type?: string; sourceNotePath?: string; groups?: string[]; clozeChildren?: number[] | null }>;
  states: Record<string, CardState>;
  enableAnimations?: boolean;
  locale?: string;
};

type StabilityBucket = {
  stability: number; // discrete stability value (center of bucket)
  count: number;
  stabilityScaled: number; // exponentially scaled stability for better distribution
};

function formatStabilityLabel(
  value: number,
  data: StabilityBucket[],
  tx: (token: string, fallback: string, vars?: Record<string, string | number>) => string,
) {
  const point = data.find((d) => Math.abs(d.stabilityScaled - Number(value)) < 0.1);
  if (!point) return `${value}`;

  const stability = point.stability;
  if (stability < 1) {
    const hours = Math.round(stability * 24);
    if (hours < 1) {
      const minutes = Math.round(stability * 24 * 60);
      return tx("ui.analytics.stability.unit.minutes", "{count} minutes", { count: minutes });
    }
    return tx("ui.analytics.stability.unit.hours", "{count} hours", { count: hours });
  }
  return tx("ui.analytics.stability.unit.days", "{count} days", { count: Math.round(stability) });
}

function createStabilityDistribution(
  cards: Array<{ id: string; type?: string; sourceNotePath?: string; groups?: string[] }>,
  states: Record<string, CardState>
): StabilityBucket[] {
  // Find max stability to determine range
  let maxStability = 0;
  for (const card of cards) {
    const state = states[String(card.id)];
    if (!state) continue;
    const stability = Number(state.stabilityDays ?? 0);
    if (Number.isFinite(stability) && stability > maxStability) {
      maxStability = stability;
    }
  }

  // Generate custom bucket points
  const generateBuckets = (max: number): number[] => {
    const buckets: number[] = [
      0,
      30 / 1440, // 30 min
      60 / 1440, // 60 min
      90 / 1440, // 90 min
      2 / 24, // 2 hours
      3 / 24, // 3 hours
      4 / 24, // 4 hours
      6 / 24, // 6 hours
      12 / 24, // 12 hours
      18 / 24, // 18 hours
      1, // 1 day
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      9,
      10, // daily up to 10
    ];

    let current = 12;
    // 10-20: increment by 2
    while (current <= 20 && current <= max + 20) {
      buckets.push(current);
      current += 2;
    }

    // 20-40: increment by 4
    current = 24;
    while (current <= 40 && current <= max + 20) {
      buckets.push(current);
      current += 4;
    }

    // 40+: increment by 10
    current = 50;
    while (current <= max + 20) {
      buckets.push(current);
      current += 10;
    }

    return buckets.sort((a, b) => a - b);
  };

  const bucketPoints = generateBuckets(maxStability);
  const buckets: Map<number, number> = new Map();

  for (const point of bucketPoints) {
    buckets.set(point, 0);
  }

  for (const card of cards) {
    const state = states[String(card.id)];
    if (!state) continue;

    const stability = Number(state.stabilityDays ?? 0);
    if (!Number.isFinite(stability)) continue;

    // Find closest bucket point
    let closestPoint = bucketPoints[0];
    let minDist = Math.abs(stability - closestPoint);

    for (const point of bucketPoints) {
      const dist = Math.abs(stability - point);
      if (dist < minDist) {
        minDist = dist;
        closestPoint = point;
      }
    }

    buckets.set(closestPoint, (buckets.get(closestPoint) ?? 0) + 1);
  }

  return Array.from(buckets.entries()).map(([stability, count]) => ({
    stability,
    count,
    // Apply exponential (sqrt) scaling to spread out lower values
    stabilityScaled: Math.sqrt(stability),
  }));
}

const typeLabels: Record<string, string> = {
  all: "All",
  basic: "Basic",
  mcq: "Multiple choice",
  "cloze-child": "Cloze (child)",
  "io-child": "Image occlusion (child)",
};

export function StabilityDistributionChart(props: StabilityDistributionChartProps) {
  const tx = React.useMemo(() => (token: string, fallback: string, vars?: Record<string, string | number>) => t(props.locale, token, fallback, vars), [props.locale]);

  const [selectedType, setSelectedType] = React.useState<string | null>(null);
  const [tagQuery, setTagQuery] = React.useState("");
  const [selectedGroups, setSelectedGroups] = React.useState<string[]>([]);
  const [deckQuery, setDeckQuery] = React.useState("");
  const [selectedDecks, setSelectedDecks] = React.useState<string[]>([]);
  const [open, setOpen] = React.useState(false);
  const [cardTypesOpen, setCardTypesOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const popoverRef = React.useRef<HTMLDivElement | null>(null);
  useAnalyticsPopoverZIndex(open, wrapRef);

  const availableTypes = React.useMemo(() => {
    return ["all", "basic", "cloze-child", "io-child", "mcq"];
  }, [props.cards]);

  const allGroups = React.useMemo(() => {
    const groups = new Set<string>();
    for (const card of props.cards ?? []) {
      const cardGroups = Array.isArray(card?.groups) ? card.groups : [];
      for (const group of cardGroups) {
        if (!group || typeof group !== "string") continue;
        const trimmed = group.trim();
        if (trimmed) groups.add(trimmed);
      }
    }
    return Array.from(groups).sort((a, b) => a.localeCompare(b));
  }, [props.cards]);

  const matchedGroups = React.useMemo(() => {
    const query = tagQuery.trim().toLowerCase();
    if (!query) return [];
    return allGroups.filter((group) => group.toLowerCase().includes(query)).slice(0, 3);
  }, [allGroups, tagQuery]);

  const allDecks = React.useMemo(() => {
    const decks = new Set<string>();
    for (const card of props.cards ?? []) {
      const deck = String(card?.sourceNotePath ?? "").trim();
      if (deck) decks.add(deck);
    }
    return Array.from(decks).sort((a, b) => a.localeCompare(b));
  }, [props.cards]);

  const matchedDecks = React.useMemo(() => {
    const query = deckQuery.trim().toLowerCase();
    if (!query) return [];
    return allDecks.filter((deck) => deck.toLowerCase().includes(query)).slice(0, 3);
  }, [allDecks, deckQuery]);

  React.useEffect(() => {
    setSelectedType("all");
  }, [availableTypes]);

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
    const placePopover = () => {
      const wrap = wrapRef.current;
      const popover = popoverRef.current;
      if (!wrap || !popover) return;
      popover.classList.remove("learnkit-ana-popover-left", "learnkit-ana-popover-left");
      popover.classList.add("learnkit-ana-popover-right", "learnkit-ana-popover-right");
    };
    placePopover();
    window.addEventListener("resize", placePopover, true);
    return () => window.removeEventListener("resize", placePopover, true);
  }, [open]);

  const filteredCards = React.useMemo(() => {
    return (props.cards ?? []).filter((card) => {
      if (!card) return false;
      const _t = String(card.type ?? "");
      if (_t === "cloze" || _t === "reversed" || _t === "io" || _t === "io-parent" || _t === "io_parent" || _t === "ioparent") return false;
      if (selectedType && selectedType !== "all" && card.type !== selectedType) return false;
      if (selectedGroups.length) {
        if (!Array.isArray(card.groups)) return false;
        const hasGroup = selectedGroups.some((group) => card.groups?.includes(group));
        if (!hasGroup) return false;
      }
      if (selectedDecks.length) {
        const deck = String(card.sourceNotePath ?? "");
        if (!selectedDecks.includes(deck)) return false;
      }
      return true;
    });
  }, [props.cards, selectedType, selectedGroups, selectedDecks]);

  const data = React.useMemo(() => createStabilityDistribution(filteredCards, props.states), [filteredCards, props.states]);

  const yAxisConfig = React.useMemo(() => {
    if (!data || data.length === 0) {
      return { max: 10, ticks: [0, 5, 10] };
    }
    const maxValue = Math.max(...data.map((d) => d.count));

    // If max < 100, round to nearest 10; otherwise round to nearest 100
    let roundedMax: number;
    if (maxValue < 100) {
      roundedMax = Math.ceil(maxValue / 10) * 10 || 10;
    } else {
      roundedMax = Math.ceil(maxValue / 100) * 100;
    }

    const halfMax = Math.round(roundedMax / 2);
    return { max: roundedMax, ticks: [0, halfMax, roundedMax] };
  }, [data]);

  const xAxisConfig = React.useMemo(() => {
    if (!data || data.length === 0) {
      return { min: 0, max: Math.sqrt(10), minLabel: "0", maxLabel: "10" };
    }
    const minStability = data[0]?.stability ?? 0;
    const maxStability = data[data.length - 1]?.stability ?? 10;

    return {
      min: Math.sqrt(minStability),
      max: Math.sqrt(maxStability),
      minLabel: Math.round(minStability).toString(),
      maxLabel: Math.round(maxStability).toString(),
    };
  }, [data]);

  const chartConfig = React.useMemo<ChartConfiguration<"line">>(() => {
    const axisColor = resolveChartColor("var(--border)");
    const tickColor = resolveChartColor("var(--text-muted)");
    const lineColor = resolveChartColor("var(--chart-accent-2)");

    return {
      type: "line",
      data: {
        datasets: [
          {
            label: tx("ui.analytics.stability.subtitle", "Cards by stability (days)"),
            data: data.map((point) => ({ x: point.stabilityScaled, y: point.count })),
            parsing: false,
            borderColor: lineColor,
            borderWidth: 2.5,
            pointRadius: 0,
            pointHoverRadius: 3,
            tension: 0.3,
            fill: true,
            backgroundColor: (ctx) =>
              makeVerticalGradient(
                ctx.chart,
                resolveChartColorWithAlpha("var(--chart-accent-2)", 0.32, ctx.chart.canvas),
                resolveChartColorWithAlpha("var(--chart-accent-2)", 0.04, ctx.chart.canvas),
              ),
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: props.enableAnimations ?? true,
        interaction: { mode: "nearest", intersect: false },
        scales: {
          x: {
            type: "linear",
            min: xAxisConfig.min,
            max: xAxisConfig.max,
            border: { color: axisColor },
            grid: { display: false },
            ticks: {
              color: tickColor,
              font: { size: 11 },
              callback: (value) => {
                const num = Number(value);
                if (!Number.isFinite(num)) return "";
                if (Math.abs(num - xAxisConfig.min) < 0.01) return xAxisConfig.minLabel;
                if (Math.abs(num - xAxisConfig.max) < 0.01) return xAxisConfig.maxLabel;
                const original = num * num;
                if (original < 1) return `${Math.round(original * 24)}h`;
                return `${Math.round(original)}d`;
              },
            },
            title: {
              display: true,
              text: tx("ui.analytics.stability.axisLabel", "Stability"),
              color: tickColor,
              font: { size: 11 },
            },
          },
          y: {
            type: "linear",
            min: 0,
            max: yAxisConfig.max,
            border: { color: axisColor },
            grid: { display: false },
            ticks: {
              color: tickColor,
              font: { size: 12 },
              callback: (value) => String(value),
            },
            afterBuildTicks: (axis) => {
              axis.ticks = yAxisConfig.ticks.map((value) => ({ value }));
            },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => {
                const value = Number(items[0]?.parsed.x ?? 0);
                return formatStabilityLabel(value, data, tx);
              },
              label: (item) => tx("ui.analytics.stability.tooltipCards", "Cards: {count}", { count: Number(item.parsed.y ?? 0) }),
            },
          },
        },
      },
    };
  }, [data, props.enableAnimations, tx, xAxisConfig.max, xAxisConfig.maxLabel, xAxisConfig.min, xAxisConfig.minLabel, yAxisConfig.max, yAxisConfig.ticks]);

  const toggleDeck = (deck: string) => {
    setSelectedDecks((prev) => {
      if (prev.includes(deck)) return prev.filter((item) => item !== deck);
      if (prev.length >= 3) return prev;
      return [...prev, deck];
    });
  };

  const toggleGroup = (group: string) => {
    setSelectedGroups((prev) => {
      if (prev.includes(group)) return prev.filter((item) => item !== group);
      if (prev.length >= 3) return prev;
      return [...prev, group];
    });
  };

  const resetFilters = () => {
    setSelectedType("all");
    setSelectedDecks([]);
    setSelectedGroups([]);
    setDeckQuery("");
    setTagQuery("");
    setCardTypesOpen(false);
    setOpen(false);
  };

  return (
    <div className={"card learnkit-ana-card h-full overflow-visible p-4 flex flex-col gap-3"}>
      <div className={"flex items-start justify-between gap-2"}>
        <div>
          <div className={"flex items-center gap-1"}>
            <div className={"font-semibold lk-home-section-title"}>{tx("ui.analytics.stability.title", "Stability distribution")}</div>
            <InfoIcon text={tx("ui.analytics.stability.info", "Distribution of cards by stability (expected retention interval). Lower values mean faster forgetting.")} />
          </div>
          <div className={"text-xs text-muted-foreground"}>{tx("ui.analytics.stability.subtitle", "Cards by stability (days)")}</div>
        </div>

        <div ref={wrapRef} className={"relative inline-flex"}>
          <button
            type="button"
            id="learnkit-stability-filter-trigger"
            className={"learnkit-btn-toolbar learnkit-btn-filter h-7 px-2 text-sm inline-flex items-center gap-2"}
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
              id="learnkit-stability-filter-popover"
              aria-hidden="false"
              ref={popoverRef}
              className={"rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-0 flex flex-col learnkit-ana-popover learnkit-ana-popover-sm learnkit-ana-popover-left"}
            >
              <div className={"p-1"}>
                <div
                  className={
                    "flex items-center justify-between text-sm text-muted-foreground px-2 py-1 cursor-pointer outline-none focus-visible:shadow-outline"
                  }
                  onClick={() => setCardTypesOpen((prev) => !prev)}
                >
                  <span>{tx("ui.analytics.chart.cardTypes", "Card Types")}</span>
                  <ChevronIcon open={cardTypesOpen} />
                </div>

                {cardTypesOpen ? (
                  <div className={"px-2 pb-2"}>
                    <div className={"flex flex-col"}>
                      {availableTypes.map((type) => (
                        <div
                          key={type}
                          role="menuitem"
                          tabIndex={0}
                          className={
                            "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                          }
                          onClick={() => setSelectedType(type)}
                        >
                          <span className={"size-3 rounded-full border border-muted-foreground/40 flex items-center justify-center"}>
                            {selectedType === type ? <span className={"size-1.5 rounded-full bg-foreground"} /> : null}
                          </span>
                          <span>{tx(`ui.analytics.chart.type.${type}`, typeLabels[type] || type)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className={"h-px bg-border my-1"} role="separator" />

                <div className={"text-sm text-muted-foreground px-2 py-1"}>{tx("ui.analytics.chart.decks", "Decks")}</div>
                <div className={"px-2 pb-2"}>
                  <input
                    type="text"
                    placeholder={tx("ui.analytics.chart.searchDecks", "Search decks")}
                    className={"input w-full text-sm learnkit-filter-search-input"}
                    value={deckQuery}
                    onChange={(event) => {
                      const next = event.currentTarget.value;
                      setDeckQuery(next);
                      if (!next.trim()) setSelectedDecks([]);
                    }}
                  />
                </div>

                {deckQuery.trim().length ? (
                  <div className={"px-2 pb-2"}>
                    <div className={"flex flex-col"}>
                      {matchedDecks.length ? (
                        matchedDecks.map((deck) => (
                          <div
                            key={deck}
                            role="menuitem"
                            tabIndex={0}
                            className={
                              "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground min-w-0"
                            }
                            onClick={() => toggleDeck(deck)}
                          >
                            <span className={"size-3 rounded-full border border-muted-foreground/40 flex items-center justify-center"}>
                              {selectedDecks.includes(deck) ? <span className={"size-1.5 rounded-full bg-foreground"} /> : null}
                            </span>
                            <span className={`truncate ${endTruncateClass}`}>
                              {formatFilterPath(deck)}
                            </span>
                          </div>
                        ))
                      ) : (
                        <div className={"px-2 py-1 text-sm text-muted-foreground"}>{tx("ui.analytics.chart.noDecksFound", "No decks found.")}</div>
                      )}
                    </div>
                  </div>
                ) : null}

                <div className={"h-px bg-border my-1"} role="separator" />

                <div className={"text-sm text-muted-foreground px-2 py-1"}>{tx("ui.analytics.chart.groups", "Groups")}</div>
                <div className={"px-2 pb-2"}>
                  <input
                    type="text"
                    placeholder={tx("ui.analytics.chart.searchGroups", "Search groups")}
                    className={"input w-full text-sm learnkit-filter-search-input"}
                    value={tagQuery}
                    onChange={(event) => {
                      const next = event.currentTarget.value;
                      setTagQuery(next);
                      if (!next.trim()) setSelectedGroups([]);
                    }}
                  />
                </div>

                {tagQuery.trim().length ? (
                  <div className={"px-2 pb-2"}>
                    <div className={"flex flex-col"}>
                      {matchedGroups.length ? (
                        matchedGroups.map((group) => (
                          <div
                            key={group}
                            role="menuitem"
                            tabIndex={0}
                            className={
                              "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground min-w-0"
                            }
                            onClick={() => toggleGroup(group)}
                          >
                            <span className={"size-3 rounded-full border border-muted-foreground/40 flex items-center justify-center"}>
                              {selectedGroups.includes(group) ? (
                                <span className={"size-1.5 rounded-full bg-foreground"} />
                              ) : null}
                            </span>
                            <span className={`truncate ${endTruncateClass}`}>
                              {formatFilterPath(group)}
                            </span>
                          </div>
                        ))
                      ) : (
                        <div className={"px-2 py-1 text-sm text-muted-foreground"}>{tx("ui.analytics.chart.noGroupsFound", "No groups found.")}</div>
                      )}
                    </div>
                  </div>
                ) : null}

                <div className={"h-px bg-border my-1"} role="separator" />

                <div className={"text-sm text-muted-foreground cursor-pointer px-2"} onClick={resetFilters}>
                  {tx("ui.analytics.chart.resetFilters", "Reset filters")}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <ChartJsCanvas
        className={"w-full flex-1 learnkit-analytics-chart"}
        config={chartConfig}
        height={250}
        ariaLabel={tx("ui.analytics.stability.title", "Stability distribution")}
      />
    </div>
  );
}
