import * as React from "react";
import {
  ArcElement,
  BarElement,
  BarController,
  CategoryScale,
  Chart as ChartJS,
  type ChartConfiguration,
  DoughnutController,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  ScatterController,
  Tooltip,
} from "chart.js";
import { color as chartColor } from "chart.js/helpers";
import annotationPlugin from "chartjs-plugin-annotation";

ChartJS.register(
  ArcElement,
  BarElement,
  BarController,
  CategoryScale,
  DoughnutController,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  ScatterController,
  Tooltip,
  annotationPlugin,
);

function resolveCssVariableToken(token: string) {
  const match = token.match(/^var\((--[\w-]+)(?:\s*,\s*([^)]+))?\)$/);
  if (!match) return null;
  const [, variableName, fallback] = match;
  return {
    variableName,
    fallback: fallback?.trim() ?? null,
  };
}

export function resolveChartColor(input: string, sourceElement?: Element | null) {
  const raw = String(input ?? "").trim();
  if (!raw) return raw;
  const parsed = resolveCssVariableToken(raw);
  if (!parsed) return raw;

  if (typeof document === "undefined") {
    return parsed.fallback ?? raw;
  }

  const styleTargets: Element[] = [];
  if (sourceElement) styleTargets.push(sourceElement);
  const scopedRoot = document.querySelector(".learnkit");
  if (scopedRoot && sourceElement !== scopedRoot) styleTargets.push(scopedRoot);
  if (document.body && sourceElement !== document.body) styleTargets.push(document.body);
  if (sourceElement !== document.documentElement) styleTargets.push(document.documentElement);

  for (const target of styleTargets) {
    const resolved = getComputedStyle(target).getPropertyValue(parsed.variableName).trim();
    if (resolved) return resolved;
  }

  return parsed.fallback ?? raw;
}

export function resolveChartColorWithAlpha(input: string, alpha: number, sourceElement?: Element | null) {
  const resolved = resolveChartColor(input, sourceElement);
  const clampedAlpha = Math.max(0, Math.min(1, alpha));
  const parsed = chartColor(resolved);
  if (!parsed.valid) return resolved;
  return parsed.alpha(clampedAlpha).rgbString();
}
export function resolveChartColors(inputs: string[], sourceElement?: Element | null) {
  return inputs.map((value) => resolveChartColor(value, sourceElement));
}

export function makeVerticalGradient(
  chart: ChartJS,
  topColor: string,
  bottomColor: string,
) {
  const area = chart.chartArea;
  if (!area) return bottomColor;
  const gradient = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
  gradient.addColorStop(0, topColor);
  gradient.addColorStop(1, bottomColor);
  return gradient;
}

function parseCssNumber(raw: string | null | undefined, fallback: number) {
  const value = Number.parseFloat(String(raw ?? "").trim());
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function resolveChartColorFallback(primaryToken: string, fallbackToken: string, sourceElement?: Element | null) {
  const primary = resolveChartColor(primaryToken, sourceElement);
  if (primary && !String(primary).trim().startsWith("var(")) return primary;
  const fallback = resolveChartColor(fallbackToken, sourceElement);
  if (fallback && !String(fallback).trim().startsWith("var(")) return fallback;
  return fallback || primary;
}

function pickDatasetColor(item: { dataset?: Record<string, unknown>; dataIndex?: number }, canvas: HTMLCanvasElement) {
  const dataset = item.dataset ?? {};
  const idx = Number(item.dataIndex ?? 0);

  const pick = (value: unknown): string | undefined => {
    if (Array.isArray(value)) {
      const entry = value[idx] ?? value[0];
      return typeof entry === "string" ? entry : undefined;
    }
    return typeof value === "string" ? value : undefined;
  };

  return (
    pick(dataset.backgroundColor) ||
    pick(dataset.borderColor) ||
    resolveChartColor("var(--theme-accent)", canvas)
  );
}

function withSharedChartDefaults(config: ChartConfiguration, canvas: HTMLCanvasElement): ChartConfiguration {
  const style = getComputedStyle(canvas);
  const options = config.options ?? {};
  const plugins = options.plugins ?? {};
  const tooltip = plugins.tooltip ?? {};
  const tooltipCallbacks =
    typeof tooltip === "object" && tooltip && "callbacks" in tooltip
      ? (tooltip as { callbacks?: Record<string, unknown> }).callbacks ?? {}
      : {};
  const existingAnimation = (options as { animation?: unknown }).animation;

  const tooltipBorderWidth = parseCssNumber(style.getPropertyValue("--learnkit-border-width"), 1);
  const tooltipRadius = parseCssNumber(style.getPropertyValue("--radius-md"), 6);
  const tooltipTextColor = resolveChartColorFallback(
    "var(--learnkit-tooltip-foreground)",
    "var(--color-base-100)",
    canvas,
  );
  const tooltipBackgroundColor = resolveChartColorFallback(
    "var(--learnkit-tooltip-surface)",
    "var(--color-base-05)",
    canvas,
  );

  const sharedTooltip = {
    backgroundColor: tooltipBackgroundColor,
    titleColor: tooltipTextColor,
    bodyColor: tooltipTextColor,
    footerColor: tooltipTextColor,
    borderColor: resolveChartColor("var(--learnkit-border-color)", canvas),
    borderWidth: tooltipBorderWidth,
    cornerRadius: tooltipRadius,
    caretSize: 0,
    caretPadding: 6,
    padding: {
      top: 6,
      right: 10,
      bottom: 6,
      left: 10,
    },
    displayColors: true,
    usePointStyle: false,
    boxWidth: 10,
    boxHeight: 10,
    boxPadding: 6,
    multiKeyBackground: "transparent",
    callbacks: {
      labelColor: (item: { dataset?: Record<string, unknown>; dataIndex?: number }) => {
        const color = pickDatasetColor(item, canvas);
        return {
          borderColor: "transparent",
          backgroundColor: color,
          borderWidth: 0,
          borderRadius: 2,
        };
      },
      labelTextColor: () => tooltipTextColor,
    },
  };

  let animation: unknown;
  if (existingAnimation === false) {
    animation = false;
  } else if (existingAnimation && typeof existingAnimation === "object") {
    animation = {
      duration: 650,
      easing: "easeOutCubic",
      ...existingAnimation,
    };
  } else {
    animation = {
      duration: 650,
      easing: "easeOutCubic",
    };
  }

  return {
    ...config,
    options: {
      ...options,
      animation: animation as never,
      plugins: {
        ...plugins,
        tooltip: {
          ...sharedTooltip,
          ...tooltip,
          callbacks: {
            ...(sharedTooltip.callbacks as Record<string, unknown>),
            ...tooltipCallbacks,
          },
        },
      },
    },
  };
}

type ChartJsCanvasProps = {
  config: ChartConfiguration;
  height: number;
  className?: string;
  ariaLabel?: string;
};

export function ChartJsCanvas(props: ChartJsCanvasProps) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const chartRef = React.useRef<ChartJS | null>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const context = canvas.getContext("2d");
    if (!context) return undefined;

    const normalizedConfig = withSharedChartDefaults(props.config, canvas);

    chartRef.current?.destroy();
    chartRef.current = new ChartJS(context, normalizedConfig);

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [props.config]);

  return (
    <div className={props.className} style={{ height: `${props.height}px`, width: "100%" }}>
      <canvas ref={canvasRef} aria-hidden="true" />
    </div>
  );
}
