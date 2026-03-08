/**
 * @file src/imageocclusion/io-mask-icon.ts
 * @summary Shared resolver for image-occlusion mask hint content.
 */

export type IoMaskHint =
  | { kind: "none" }
  | { kind: "icon"; value: string }
  | { kind: "text"; value: string };

/**
 * Normalize persisted IO mask-icon setting values into a renderable hint.
 * Supports current values and older aliases for backward compatibility.
 */
export function resolveIoMaskHint(settingValue: string | null | undefined): IoMaskHint {
  const raw = String(settingValue ?? "").trim();
  if (!raw || raw.toLowerCase() === "none") return { kind: "none" };

  const normalized = raw.toLowerCase();
  if (normalized === "question-circle" || normalized === "circle-help") {
    return { kind: "icon", value: "circle-help" };
  }
  if (normalized === "eye" || normalized === "eye-off") {
    return { kind: "icon", value: "eye" };
  }

  return { kind: "text", value: raw };
}
