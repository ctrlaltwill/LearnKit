import * as React from "react";
import { ComposedChart, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import { createXAxisTicks, formatAxisLabel } from "../chart-axis-utils";
import { useAnalyticsPopoverZIndex } from "../filter-styles";
import { MS_DAY } from "../../../platform/core/constants";

type AnalyticsExamAttemptEventLike = {
  kind?: string;
  at?: number;
  testId?: string;
  attemptId?: string;
  label?: string;
  sourceSummary?: string;
  finalPercent?: number;
  autoSubmitted?: boolean;
  elapsedSec?: number;
  mcqCount?: number;
  saqCount?: number;
};

type SavedExamAttemptRecordLike = {
  attemptId: string;
  testId: string;
  label: string;
  sourceSummary: string;
  finalPercent: number | null;
  autoSubmitted: boolean;
  resultsJson: string;
  createdAt: number;
};

type ExamAttemptRow = {
  id: string;
  at: number;
  score: number;
  autoSubmitted: boolean;
  mcqCount: number;
  saqCount: number;
  elapsedSec: number | null;
  attemptedCount: number | null;
};

type ScatterPoint = {
  dayIndex: number;
  score: number;
  date: string;
  autoSubmitted: boolean;
};

function makeDatePartsFormatter(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function localDayIndex(ts: number, formatter: Intl.DateTimeFormat): number {
  const parts = formatter.formatToParts(new Date(ts));
  const map = new Map(parts.map((p) => [p.type, p.value]));
  const year = Number(map.get("year"));
  const month = Number(map.get("month"));
  const day = Number(map.get("day"));
  return Math.floor(Date.UTC(year, month - 1, day) / MS_DAY);
}

function formatDayLabel(dayIdx: number, timeZone: string): string {
  const date = new Date(dayIdx * MS_DAY);
  return date.toLocaleDateString(undefined, { timeZone, month: "short", day: "numeric" });
}

function formatDayTitle(dayIdx: number, timeZone: string): string {
  const date = new Date(dayIdx * MS_DAY);
  return date.toLocaleDateString(undefined, { timeZone, weekday: "short", month: "short", day: "numeric" });
}

function InfoIcon(props: { text: string }) {
  return (
    <span className="inline-flex items-center text-muted-foreground" data-tooltip={props.text} data-tooltip-position="right">
      <svg className="svg-icon lucide-info" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4" />
        <path d="M12 8h.01" />
      </svg>
    </span>
  );
}

function ChevronIcon(props: { open: boolean }) {
  return (
    <svg
      className={`svg-icon sprout-ana-chevron${props.open ? " is-open" : ""}`}
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

function parseCountsFromResultsJson(raw: string): { mcqCount: number; saqCount: number; elapsedSec: number | null; attemptedCount: number | null } {
  try {
    const parsed = JSON.parse(String(raw || "{}")) as {
      results?: Array<{ questionType?: string; userAnswer?: string }>;
      elapsedSec?: number;
    };
    const rows = Array.isArray(parsed.results) ? parsed.results : [];
    const mcqCount = rows.filter((row) => String(row?.questionType || "") === "mcq").length;
    const saqCount = rows.filter((row) => String(row?.questionType || "") === "saq").length;
    const attemptedCount = rows.filter((row) => String(row?.userAnswer || "").trim().length > 0).length;
    const elapsedSec = Number.isFinite(parsed.elapsedSec) ? Number(parsed.elapsedSec) : null;
    return { mcqCount, saqCount, elapsedSec, attemptedCount };
  } catch {
    return { mcqCount: 0, saqCount: 0, elapsedSec: null, attemptedCount: null };
  }
}

function shouldExcludeNoStudyAttempt(row: ExamAttemptRow): boolean {
  return row.score === 0 && row.attemptedCount === 0;
}

function toRows(
  events: AnalyticsExamAttemptEventLike[],
  dbAttempts: SavedExamAttemptRecordLike[],
): ExamAttemptRow[] {
  const out: ExamAttemptRow[] = [];

  for (const ev of events) {
    if (!ev || ev.kind !== "exam-attempt") continue;
    const at = Number(ev.at);
    const score = Number(ev.finalPercent);
    if (!Number.isFinite(at) || !Number.isFinite(score)) continue;
    out.push({
      id: String(ev.attemptId || `${ev.testId || "test"}-${at}-${score.toFixed(2)}`),
      at,
      score: Math.max(0, Math.min(100, score)),
      autoSubmitted: Boolean(ev.autoSubmitted),
      mcqCount: Number.isFinite(ev.mcqCount) ? Number(ev.mcqCount) : 0,
      saqCount: Number.isFinite(ev.saqCount) ? Number(ev.saqCount) : 0,
      elapsedSec: Number.isFinite(ev.elapsedSec) ? Number(ev.elapsedSec) : null,
      attemptedCount: null,
    });
  }

  for (const row of dbAttempts) {
    const at = Number(row.createdAt);
    const score = Number(row.finalPercent);
    if (!Number.isFinite(at) || !Number.isFinite(score)) continue;
    const parsed = parseCountsFromResultsJson(row.resultsJson);
    out.push({
      id: String(row.attemptId || `${row.testId}-${at}-${score.toFixed(2)}`),
      at,
      score: Math.max(0, Math.min(100, score)),
      autoSubmitted: Boolean(row.autoSubmitted),
      mcqCount: parsed.mcqCount,
      saqCount: parsed.saqCount,
      elapsedSec: parsed.elapsedSec,
      attemptedCount: parsed.attemptedCount,
    });
  }

  const deduped = new Map<string, ExamAttemptRow>();
  for (const row of out) {
    const existing = deduped.get(row.id);
    if (!existing) {
      deduped.set(row.id, row);
      continue;
    }

    const existingHasAttempted = existing.attemptedCount != null;
    const incomingHasAttempted = row.attemptedCount != null;
    if (!existingHasAttempted && incomingHasAttempted) {
      deduped.set(row.id, row);
    }
  }

  return Array.from(deduped.values()).sort((a, b) => a.at - b.at);
}

function ScatterTooltipContent(props: { active?: boolean; payload?: Array<{ payload?: unknown }> }) {
  if (!props.active || !props.payload || !props.payload.length) return null;
  const datum = props.payload[0]?.payload as ScatterPoint | undefined;
  if (!datum) return null;
  return (
    <div className="sprout-data-tooltip-surface">
      <div className="text-sm font-medium text-background">{datum.date}</div>
      <div className="text-background">Score: {datum.score}%</div>
      {datum.autoSubmitted ? <div className="text-background">Auto-submitted</div> : null}
    </div>
  );
}

function linearRegression(points: Array<{ x: number; y: number }>): { slope: number; intercept: number } {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: n === 1 ? points[0].y : 0 };
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumX2 += p.x * p.x;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

function buildScatterData(
  rows: ExamAttemptRow[],
  durationDays: number,
  formatter: Intl.DateTimeFormat,
  tz: string,
  todayIdx: number,
): ScatterPoint[] {
  const startIdx = todayIdx - (durationDays - 1);
  const out: ScatterPoint[] = [];
  for (const row of rows) {
    const idx = localDayIndex(row.at, formatter);
    if (idx < startIdx || idx > todayIdx) continue;
    if (shouldExcludeNoStudyAttempt(row)) continue;
    out.push({
      dayIndex: idx,
      score: row.score,
      date: formatDayTitle(idx, tz),
      autoSubmitted: row.autoSubmitted,
    });
  }
  return out;
}

export function TestsAnalyticsCard(props: {
  events: AnalyticsExamAttemptEventLike[];
  dbAttempts: SavedExamAttemptRecordLike[];
  timezone?: string;
}) {
  const tz = props.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const formatter = React.useMemo(() => makeDatePartsFormatter(tz), [tz]);
  const [durationDays, setDurationDays] = React.useState(30);
  const [open, setOpen] = React.useState(false);
  const [durationOpen, setDurationOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const popoverRef = React.useRef<HTMLDivElement | null>(null);
  useAnalyticsPopoverZIndex(open, wrapRef);

  const todayIdx = React.useMemo(() => localDayIndex(Date.now(), formatter), [formatter]);
  const startIdx = todayIdx - (durationDays - 1);

  React.useEffect(() => {
    if (!open) return;
    const onDocClick = (ev: MouseEvent) => {
      const target = ev.target as Node | null;
      if (!target || !wrapRef.current) return;
      if (!wrapRef.current.contains(target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick, true);
    return () => document.removeEventListener("mousedown", onDocClick, true);
  }, [open]);

  const toggleDurationOpen = React.useCallback(() => {
    setDurationOpen((value) => !value);
  }, []);

  const onDurationKey = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setDurationOpen((value) => !value);
    }
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const placePopover = () => {
      const popover = popoverRef.current;
      if (!popover) return;
      popover.classList.remove("sprout-ana-popover-left");
      popover.classList.add("sprout-ana-popover-right");
    };
    placePopover();
    window.addEventListener("resize", placePopover, true);
    return () => window.removeEventListener("resize", placePopover, true);
  }, [open]);

  const allRows = React.useMemo(() => toRows(props.events, props.dbAttempts), [props.events, props.dbAttempts]);
  const scatterData = React.useMemo(
    () => buildScatterData(allRows, durationDays, formatter, tz, todayIdx),
    [allRows, durationDays, formatter, tz, todayIdx],
  );

  const trendData = React.useMemo(() => {
    if (scatterData.length < 2) return [];
    const reg = linearRegression(scatterData.map((p) => ({ x: p.dayIndex, y: p.score })));
    const minIdx = scatterData[0].dayIndex;
    const maxIdx = scatterData[scatterData.length - 1].dayIndex;
    const clamp = (v: number) => Math.max(0, Math.min(100, v));
    return [
      { dayIndex: minIdx, trendScore: clamp(reg.slope * minIdx + reg.intercept) },
      { dayIndex: maxIdx, trendScore: clamp(reg.slope * maxIdx + reg.intercept) },
    ];
  }, [scatterData]);

  const xTicks = React.useMemo(() => {
    const endIdx = startIdx + durationDays - 1;
    return createXAxisTicks(startIdx, endIdx, todayIdx);
  }, [startIdx, durationDays, todayIdx]);

  const xTickFormatter = (value: number) =>
    formatAxisLabel(value, todayIdx, (idx) => formatDayLabel(idx, tz));

  const durationOptions = React.useMemo(() => [7, 30, 90], []);

  return (
    <div className="card sprout-ana-card h-full overflow-visible p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1">
            <div className="font-semibold lk-home-section-title">Tests performance</div>
            <InfoIcon text="Individual test scores with trend over time." />
          </div>
          <div className="text-xs text-muted-foreground">Score distribution over time</div>
        </div>
        <div ref={wrapRef} className="relative inline-flex">
          <button
            type="button"
            id="sprout-tests-filter-trigger"
            className="sprout-btn-toolbar sprout-btn-filter h-7 px-2 text-sm inline-flex items-center gap-2"
            aria-haspopup="listbox"
            aria-expanded={open ? "true" : "false"}
            aria-label="Filter"
            data-tooltip-position="top"
            onClick={() => setOpen((v) => !v)}
          >
            <svg className="svg-icon lucide-filter text-foreground" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="22 3 2 3 10 12.5 10 19 14 21 14 12.5 22 3" />
            </svg>
            <span>Filter</span>
          </button>
          {open ? (
            <div
              ref={popoverRef}
              className="rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-0 flex flex-col sprout-ana-popover sprout-ana-popover-sm"
              role="listbox"
              aria-label="Tests filters"
            >
              <div className="p-1">
                <div
                  className="flex items-center justify-between text-sm text-muted-foreground px-2 py-1 cursor-pointer outline-none focus-visible:shadow-outline"
                  role="button"
                  tabIndex={0}
                  aria-expanded={durationOpen ? "true" : "false"}
                  aria-label="Duration"
                  data-tooltip-position="top"
                  onClick={toggleDurationOpen}
                  onKeyDown={onDurationKey}
                >
                  <span>Duration</span>
                  <ChevronIcon open={durationOpen} />
                </div>
                {durationOpen ? (
                  <div role="menu" aria-orientation="vertical" className="flex flex-col">
                    {durationOptions.map((value) => (
                      <div
                        key={value}
                        role="menuitemradio"
                        aria-checked={durationDays === value ? "true" : "false"}
                        tabIndex={0}
                        className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer select-none outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                        onClick={() => setDurationDays(value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setDurationDays(value);
                          }
                        }}
                      >
                        <div className="size-4 flex items-center justify-center">
                          <div
                            className="size-2 rounded-full bg-foreground invisible group-aria-checked:visible"
                            aria-hidden="true"
                          />
                        </div>
                        <span>{value}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {scatterData.length === 0 ? (
        <div className="text-sm text-muted-foreground">No test attempts yet.</div>
      ) : (
        <>
          <div className="bc w-full flex-1 sprout-analytics-chart">
            <ResponsiveContainer width="100%" height={250}>
              <ComposedChart margin={{ left: 8, right: 8, top: 12, bottom: 12 }}>
                <XAxis
                  dataKey="dayIndex"
                  type="number"
                  domain={[startIdx, todayIdx]}
                  ticks={xTicks}
                  tickFormatter={xTickFormatter}
                  tick={{ fontSize: 11 }}
                />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} width={30} tickFormatter={(v: number) => `${v}%`} />
                <Tooltip content={<ScatterTooltipContent />} cursor={{ fill: "var(--background-modifier-hover)", opacity: 0.5 }} />
                <Scatter data={scatterData} dataKey="score" name="Score" fill="var(--chart-accent-2)" fillOpacity={0.8} />
                {trendData.length >= 2 ? (
                  <Line data={trendData} dataKey="trendScore" name="Trend" stroke="var(--chart-accent-3)" strokeWidth={2} dot={false} strokeDasharray="6 3" />
                ) : null}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="bc flex flex-wrap gap-3 text-xs text-muted-foreground sprout-ana-chart-legend">
            <div className="bc inline-flex items-center gap-2"><span className="bc inline-block sprout-ana-legend-dot" style={{ ["--sprout-legend-color" as string]: "var(--chart-accent-2)" }} />Score</div>
            <div className="bc inline-flex items-center gap-2"><span className="bc inline-block sprout-ana-legend-line sprout-ana-legend-line-dashed" style={{ ["--sprout-legend-color" as string]: "var(--chart-accent-3)" }} />Trend</div>
          </div>
        </>
      )}
    </div>
  );
}
