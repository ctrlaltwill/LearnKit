import type { AssistantMode } from "../types/assistant-popup-types";
import type { StudyAssistantReviewDepth } from "../../../platform/integrations/ai/study-assistant-types";

export const ASSISTANT_MODES: readonly AssistantMode[] = ["assistant", "review", "generate"];

export const ASSISTANT_REVIEW_DEPTHS: readonly StudyAssistantReviewDepth[] = [
	"quick",
	"standard",
	"comprehensive",
];

export function isAssistantReviewDepth(value: unknown): value is StudyAssistantReviewDepth {
	return typeof value === "string" && ASSISTANT_REVIEW_DEPTHS.includes(value as StudyAssistantReviewDepth);
}

export const CHAT_LOG_SYNC_EVENT_NAME = "sprout-study-assistant-chatlog-synced";
