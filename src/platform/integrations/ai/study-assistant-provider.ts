import { requestUrl } from "obsidian";
import type { SproutSettings } from "../../types/settings";
import type { StudyAssistantProvider } from "./study-assistant-types";

type CompletionMode = "text" | "json";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function providerBaseUrl(settings: SproutSettings["studyAssistant"]): string {
  const override = String(settings.endpointOverride || "").trim();
  if (override) {
    if (!isValidHttpUrl(override)) {
      throw new Error(`Invalid endpoint URL: must start with https:// or http://`);
    }
    return trimTrailingSlash(override);
  }

  if (settings.provider === "custom") return "";

  if (settings.provider === "openai") return "https://api.openai.com/v1";
  if (settings.provider === "anthropic") return "https://api.anthropic.com/v1";
  if (settings.provider === "deepseek") return "https://api.deepseek.com/v1";
  return "https://api.groq.com/openai/v1";
}

function providerApiKey(
  provider: StudyAssistantProvider,
  apiKeys: SproutSettings["studyAssistant"]["apiKeys"],
): string {
  if (provider === "openai") return String(apiKeys.openai || "").trim();
  if (provider === "anthropic") return String(apiKeys.anthropic || "").trim();
  if (provider === "deepseek") return String(apiKeys.deepseek || "").trim();
  if (provider === "groq") return String(apiKeys.groq || "").trim();
  return String(apiKeys.custom || "").trim();
}

function parseJsonFromUnknown(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function shouldOmitTemperature(provider: StudyAssistantProvider, model: string): boolean {
  if (provider !== "openai") return false;
  const m = String(model || "").trim().toLowerCase();
  // Some OpenAI model families enforce fixed/default sampling behavior.
  return m.startsWith("gpt-5") || m.startsWith("o1") || m.startsWith("o3") || m.startsWith("o4");
}

function providerErrorDetail(res: { json?: unknown; text?: string }): string {
  const json = parseJsonFromUnknown(res.json);
  const err = parseJsonFromUnknown(json?.error);
  const message = typeof err?.message === "string" ? err.message.trim() : "";
  if (message) return message;
  const rawText = typeof res.text === "string" ? res.text.trim() : "";
  return rawText;
}

function extractTextFromOpenAiLikeResponse(json: Record<string, unknown>): string {
  const choices = Array.isArray(json.choices) ? json.choices : [];
  const firstChoice = parseJsonFromUnknown(choices[0]);
  const message = parseJsonFromUnknown(firstChoice?.message);
  const content = message?.content;

  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      const obj = parseJsonFromUnknown(block);
      if (typeof obj?.text === "string") parts.push(obj.text);
    }
    if (parts.length) return parts.join("\n");
  }

  return "";
}

function extractTextFromAnthropicResponse(json: Record<string, unknown>): string {
  const content = Array.isArray(json.content) ? json.content : [];
  const parts: string[] = [];

  for (const block of content) {
    const obj = parseJsonFromUnknown(block);
    if (!obj) continue;
    if (obj.type === "text" && typeof obj.text === "string") {
      parts.push(obj.text);
    }
  }

  return parts.join("\n").trim();
}

export async function requestStudyAssistantCompletion(params: {
  settings: SproutSettings["studyAssistant"];
  systemPrompt: string;
  userPrompt: string;
  imageDataUrls?: string[];
  mode?: CompletionMode;
}): Promise<string> {
  const { settings, systemPrompt, userPrompt, imageDataUrls = [], mode = "text" } = params;

  const apiKey = providerApiKey(settings.provider, settings.apiKeys);
  if (!apiKey) {
    throw new Error(`Missing API key for provider: ${settings.provider}`);
  }

  const base = providerBaseUrl(settings);
  const model = String(settings.model || "").trim();

  if (!base) {
    throw new Error("Missing endpoint override for custom provider.");
  }

  if (!model) throw new Error("Missing model name in Study Assistant settings.");

  const usableImageDataUrls = imageDataUrls
    .map((url) => String(url || "").trim())
    .filter((url) => /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i.test(url));

  if (settings.provider === "anthropic") {
    const res = await requestUrl({
      url: `${base}/messages`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 2500,
        system: systemPrompt,
        messages: [{
          role: "user",
          content: usableImageDataUrls.length
            ? [
                { type: "text", text: userPrompt },
                ...usableImageDataUrls.map((url) => {
                  const match = url.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
                  if (!match) {
                    return {
                      type: "image",
                      source: {
                        type: "base64",
                        media_type: "image/png",
                        data: "",
                      },
                    };
                  }
                  return {
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: match[1],
                      data: match[2],
                    },
                  };
                }).filter((block) => block.source.data),
              ]
            : userPrompt,
        }],
      }),
    });

    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Anthropic request failed (${res.status})`);
    }

    const json = parseJsonFromUnknown(res.json);
    const text = json ? extractTextFromAnthropicResponse(json) : "";
    if (!text) throw new Error("Anthropic response did not include text content.");
    return text;
  }

  const res = await requestUrl({
    url: `${base}/chat/completions`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: usableImageDataUrls.length
            ? [
                { type: "text", text: userPrompt },
                ...usableImageDataUrls.map((url) => ({
                  type: "image_url",
                  image_url: { url },
                })),
              ]
            : userPrompt,
        },
      ],
      ...(shouldOmitTemperature(settings.provider, model) ? {} : { temperature: 0.4 }),
      ...(mode === "json" ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  if (res.status < 200 || res.status >= 300) {
    const detail = providerErrorDetail(res);
    throw new Error(
      detail
        ? `${settings.provider} request failed (${res.status}): ${detail}`
        : `${settings.provider} request failed (${res.status})`,
    );
  }

  const json = parseJsonFromUnknown(res.json);
  const text = json ? extractTextFromOpenAiLikeResponse(json) : "";
  if (!text) throw new Error(`${settings.provider} response did not include text content.`);
  return text;
}
