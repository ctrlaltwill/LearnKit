import { log } from "../../../platform/core/logger";
import { safeText } from "./assistant-popup-helpers";
import { formatProviderLabel } from "./assistant-popup-provider";

type Tx = (token: string, fallback: string, vars?: Record<string, string | number>) => string;

export type AssistantErrorContext = "ask" | "review" | "generate";

export function assistantConsoleErrorDetails(error: unknown): Record<string, unknown> {
  const details: Record<string, unknown> = {};
  if (error instanceof Error) {
    details.name = error.name;
    details.message = error.message;
    if (error.stack) details.stack = error.stack;
  }

  if (error && typeof error === "object") {
    const map = error as Record<string, unknown>;
    const keys = [
      "provider",
      "status",
      "detail",
      "endpoint",
      "responseText",
      "responseJson",
      "originalError",
    ];
    for (const key of keys) {
      if (map[key] !== undefined) details[key] = map[key];
    }
  }

  return details;
}

export function logAssistantRequestError(
  context: AssistantErrorContext,
  error: unknown,
  userMessage: string,
): void {
  log.error(
    `[Study Companion] ${context} request failed`,
    error,
    {
      userMessage,
      ...assistantConsoleErrorDetails(error),
    },
  );
}

export function formatAssistantError(error: unknown, tx: Tx): string {
  const raw = safeText(error instanceof Error ? error.message : error)
    .replace(/^error:\s*/i, "")
    .trim();

  if (!raw) {
    return tx(
      "ui.studyAssistant.error.generic",
      "Error: AI request failed. Please try again.",
    );
  }

  const unknownProvider = () => tx("ui.studyAssistant.provider.unknown", "AI provider");

  const missingKey = raw.match(/^Missing API key for provider:\s*([a-z0-9_-]+)$/i);
  if (missingKey?.[1]) {
    return tx(
      "ui.studyAssistant.error.missingApiKey",
      "Error: API key missing for {provider}. Add it in Study Companion settings.",
      { provider: formatProviderLabel(missingKey[1], unknownProvider) },
    );
  }

  if (/^Missing endpoint override for custom provider\.?$/i.test(raw)) {
    return tx(
      "ui.studyAssistant.error.missingEndpoint",
      "Error: Endpoint missing for Custom provider. Set an endpoint URL in Study Companion settings.",
    );
  }

  if (/^Missing model name in Study Companion settings\.?$/i.test(raw)) {
    return tx(
      "ui.studyAssistant.error.missingModel",
      "Error: Model missing. Choose a model in Study Companion settings.",
    );
  }

  const httpFailure = raw.match(/^([a-z0-9_-]+) request failed \((\d{3})\)$/i);
  if (httpFailure?.[1] && httpFailure?.[2]) {
    const provider = formatProviderLabel(httpFailure[1], unknownProvider);
    const status = httpFailure[2];

    if (status === "402") {
      return tx(
        "ui.studyAssistant.error.http402",
        "Error: AI request failed ({provider}, HTTP 402). Check credits/billing and model access.",
        { provider },
      );
    }

    return tx(
      "ui.studyAssistant.error.http",
      "Error: AI request failed ({provider}, HTTP {status}). Check API key, model, and endpoint.",
      { provider, status },
    );
  }

  const emptyText = raw.match(/^([a-z0-9_-]+) response did not include text content\.?$/i);
  if (emptyText?.[1]) {
    return tx(
      "ui.studyAssistant.error.emptyResponse",
      "Error: AI returned an empty response from {provider}. Try again or switch models.",
      { provider: formatProviderLabel(emptyText[1], unknownProvider) },
    );
  }

  return tx(
    "ui.studyAssistant.error.withDetails",
    "Error: AI request failed. {details}",
    { details: raw },
  );
}
