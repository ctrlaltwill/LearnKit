/**
 * @file src/platform/core/view-primitives.ts
 * @summary Module for view primitives.
 *
 * @exports
 *  - TitleStripFrameOptions
 *  - TitleStripFrame
 *  - createTitleStripFrame
 */
import {  } from "obsidian";

import { SPROUT_TITLE_STRIP_LABEL_CLASS } from "./ui-classes";

export interface TitleStripFrameOptions {
  root: HTMLElement;
  stripClassName: string;
  rowClassName?: string;
  leftClassName?: string;
  rightClassName?: string;
  prepend?: boolean;
}

export interface TitleStripFrame {
  strip: HTMLDivElement;
  row: HTMLDivElement;
  left: HTMLDivElement;
  right: HTMLDivElement;
  title: HTMLDivElement;
  subtitle: HTMLDivElement;
}

export function createTitleStripFrame(opts: TitleStripFrameOptions): TitleStripFrame {
  const {
    root,
    stripClassName,
    rowClassName = "sprout-inline-sentence w-full flex items-center justify-between gap-[10px]",
    leftClassName = "min-w-0 flex-1 flex flex-col gap-[2px]",
    rightClassName = "flex items-center gap-2",
    prepend = true,
  } = opts;

  const strip = activeDocument.createElement("div");
  strip.className = stripClassName;

  const row = activeDocument.createElement("div");
  row.className = rowClassName;

  const left = activeDocument.createElement("div");
  left.className = leftClassName;

  const title = activeDocument.createElement("div");
  title.className = SPROUT_TITLE_STRIP_LABEL_CLASS;

  const subtitle = activeDocument.createElement("div");
  subtitle.className = "text-[0.95rem] font-normal leading-[1.3] text-muted-foreground";

  left.appendChild(title);
  left.appendChild(subtitle);

  const right = activeDocument.createElement("div");
  right.className = rightClassName;

  row.appendChild(left);
  row.appendChild(right);
  strip.appendChild(row);

  if (prepend) root.prepend(strip);
  else root.appendChild(strip);

  return { strip, row, left, right, title, subtitle };
}
