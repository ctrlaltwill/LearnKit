/**
 * @file src/views/coach/coach-charts.tsx
 * @summary Module for coach charts.
 *
 * @exports
 *  - ExamReadinessPoint
 *  - CoachHealthPanelProps
 *  - CoachHealthPanel
 *  - CoachReadinessPanelProps
 *  - CoachReadinessPanel
 */

import * as React from "react";
import type { ChartConfiguration } from "chart.js";
import { ChartJsCanvas, makeVerticalGradient, resolveChartColor } from "../analytics/charts/chartjs-canvas";

export type ExamReadinessPoint = {
  dayIndex: number;
  label: string;
  readiness: number | null;
  projected: number | null;
};

function SizedChartContainer(props: { className: string; children: React.ReactNode }) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const [isReady, setIsReady] = React.useState(false);

  React.useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const updateReady = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      setIsReady(width > 0 && height > 0);
    };

    updateReady();

    const observer = new ResizeObserver(updateReady);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={hostRef} className={props.className}>
      {isReady ? props.children : null}
    </div>
  );
}

function scoreColor(label: string): string {
  if (label === "ready" || label === "on-track") return "var(--chart-accent-3)";
  if (label === "at-risk") return "var(--chart-accent-2)";
  return "var(--chart-accent-1)";
}

function scoreName(label: string): string {
  return label.replace("-", " ");
}

function HealthIndicatorRow(props: {
  title: string;
  score: number;
  label: string;
  statusText: string;
  tx: (token: string, fallback: string, vars?: Record<string, string | number>) => string;
}) {
  const barColor = scoreColor(props.label);
  const clampedScore = Math.max(0, Math.min(100, props.score));
  const tip = props.tx("ui.view.coach.health.rowTooltip", "{title}: {score}% - {status}", {
    title: props.title,
    score: props.score,
    status: props.statusText,
  });
  return (
    <div
      className="learnkit-coach-health-bar-row"
      data-tooltip={tip}
      data-tooltip-position="top"
      data-status={props.label}
    >
      <div className="learnkit-coach-health-bar-meta">
        <div className="learnkit-coach-health-bar-title">{props.title}</div>
        <div className="learnkit-coach-health-bar-status" style={{ color: barColor }}>
          {props.statusText}
        </div>
      </div>
      <div className="learnkit-coach-health-bar-track">
        <div className="learnkit-coach-health-bar-fill learnkit-coach-health-bar-fill-animated" style={{ "--learnkit-health-bar-width": `${clampedScore}%`, backgroundColor: barColor } as React.CSSProperties} />
      </div>
      <div className="learnkit-coach-health-bar-score" style={{ color: barColor }}>
        {props.score}%
      </div>
    </div>
  );
}

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

export type CoachHealthPanelProps = {
  tx: (token: string, fallback: string, vars?: Record<string, string | number>) => string;
  flash: { score: number; label: string };
  note: { score: number; label: string };
  exam: { score: number; label: string };
};

export function CoachHealthPanel(props: CoachHealthPanelProps) {
  const statusText = (label: string): string => props.tx(`ui.view.coach.health.status.${label}`, scoreName(label));
  return (
    <div className="card learnkit-coach-health-summary-card">
      <div className="learnkit-coach-progress-header">
        <div>
          <div className="learnkit-coach-health-heading-row">
            <div className="learnkit-coach-health-title">{props.tx("ui.view.coach.health.title", "Study Plan Health")}</div>
            <InfoIcon text={props.tx("ui.view.coach.health.info", "Flashcard health blends FSRS retrievability for studied cards with time feasibility for unstudied cards. Note health uses the same model for reviewed vs unreviewed notes. Exam health is a weighted composite of both.")} />
          </div>
          <div className="learnkit-coach-step-copy">{props.tx("ui.view.coach.health.subtitle", "At-a-glance breakdown of your study health")}</div>
        </div>
      </div>
      <div className="learnkit-coach-health-bars">
        <HealthIndicatorRow
          title={props.tx("ui.common.flashcards", "Flashcards")}
          score={props.flash.score}
          label={props.flash.label}
          statusText={statusText(props.flash.label)}
          tx={props.tx}
        />
        <HealthIndicatorRow
          title={props.tx("ui.common.notes", "Notes")}
          score={props.note.score}
          label={props.note.label}
          statusText={statusText(props.note.label)}
          tx={props.tx}
        />
        <HealthIndicatorRow
          title={props.tx("ui.view.coach.health.exam", "Exam")}
          score={props.exam.score}
          label={props.exam.label}
          statusText={statusText(props.exam.label)}
          tx={props.tx}
        />
      </div>
    </div>
  );
}

export type CoachReadinessPanelProps = {
  tx: (token: string, fallback: string, vars?: Record<string, string | number>) => string;
  readiness: ExamReadinessPoint[];
  todayIndex: number;
  startLabel: string;
  endLabel: string;
  totalDays: number;
};

export function CoachReadinessPanel(props: CoachReadinessPanelProps) {
  const { readiness, todayIndex, startLabel, endLabel, totalDays } = props;

  const chartConfig = React.useMemo<ChartConfiguration<"line">>(() => {
    const axisColor = resolveChartColor("var(--border)");
    const tickColor = resolveChartColor("var(--text-muted)");
    const readinessColor = resolveChartColor("var(--chart-accent-3)");
    const projectedColor = resolveChartColor("var(--chart-accent-2)");

    return {
      type: "line",
      data: {
        datasets: [
          {
            label: props.tx("ui.view.coach.readiness.label", "Readiness"),
            data: readiness.map((point) => ({ x: point.dayIndex, y: point.readiness })),
            parsing: false,
            borderColor: readinessColor,
            borderWidth: 2,
            pointRadius: 0,
            spanGaps: false,
            tension: 0.3,
            fill: true,
            backgroundColor: (ctx) => makeVerticalGradient(ctx.chart, `${readinessColor}59`, `${readinessColor}08`),
          },
          {
            label: props.tx("ui.view.coach.readiness.projected", "Projected"),
            data: readiness.map((point) => ({ x: point.dayIndex, y: point.projected })),
            parsing: false,
            borderColor: projectedColor,
            borderWidth: 2,
            borderDash: [6, 3],
            pointRadius: 0,
            spanGaps: true,
            tension: 0.3,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: {
            type: "linear",
            min: 0,
            max: totalDays,
            border: { color: axisColor },
            grid: { display: false },
            ticks: {
              color: tickColor,
              font: { size: 11 },
              callback: (value) => {
                const day = Number(value);
                if (day === 0) return startLabel;
                if (day === totalDays) return endLabel;
                return "";
              },
            },
          },
          y: {
            min: 0,
            max: 100,
            border: { color: axisColor },
            grid: { display: false },
            ticks: {
              color: tickColor,
              font: { size: 11 },
            },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => String(items[0]?.label ?? ""),
              label: (item) => `${item.dataset.label ?? ""}: ${Math.round(Number(item.parsed.y ?? 0))}`,
            },
          },
          annotation: {
            annotations: {
              today: {
                type: "line",
                xMin: todayIndex,
                xMax: todayIndex,
                borderColor: tickColor,
                borderDash: [4, 3],
                borderWidth: 1,
                label: {
                  display: true,
                  content: props.tx("ui.view.coach.readiness.today", "Today"),
                  color: tickColor,
                  position: "start",
                  font: { size: 11, weight: 500 },
                },
              },
            },
          },
        },
      },
    };
  }, [endLabel, props, readiness, startLabel, todayIndex, totalDays]);

  return (
    <div className="card learnkit-coach-timeline-rechart-card">
      <div className="learnkit-coach-progress-header">
        <div>
          <div className="flex items-center gap-1">
            <div className="learnkit-coach-health-title">{props.tx("ui.view.coach.readiness.title", "Exam Readiness")}</div>
            <InfoIcon text={props.tx("ui.view.coach.readiness.info", "Blends card mastery (FSRS retrievability) with time feasibility for remaining material into a 0-100 score. The dashed line projects readiness assuming you follow your daily targets.")} />
          </div>
          <div className="learnkit-coach-step-copy">{props.tx("ui.view.coach.readiness.subtitle", "Track how ready you are - from now until exam day")}</div>
        </div>
      </div>

      <SizedChartContainer className="learnkit-coach-timeline-rechart">
        <ChartJsCanvas
          className="w-full h-full"
          config={chartConfig}
          height={240}
          ariaLabel={props.tx("ui.view.coach.readiness.title", "Exam Readiness")}
        />
      </SizedChartContainer>

      <div className="learnkit-coach-chart-legend">
        <div className="learnkit-coach-legend-item">
          <span className="learnkit-coach-legend-swatch" style={{ backgroundColor: "var(--chart-accent-3)" }} />
          <span>{props.tx("ui.view.coach.readiness.label", "Readiness")}</span>
        </div>
        <div className="learnkit-coach-legend-item">
          <span className="learnkit-coach-legend-line learnkit-coach-legend-dashed" style={{ borderColor: "var(--chart-accent-2)" }} />
          <span>{props.tx("ui.view.coach.readiness.projected", "Projected")}</span>
        </div>
        <div className="learnkit-coach-legend-item">
          <span className="learnkit-coach-legend-line learnkit-coach-legend-dashed" style={{ borderColor: "var(--text-muted)" }} />
          <span>{props.tx("ui.view.coach.readiness.today", "Today")}</span>
        </div>
      </div>
    </div>
  );
}
