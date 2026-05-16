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

    chartRef.current?.destroy();
    chartRef.current = new ChartJS(context, props.config);

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
