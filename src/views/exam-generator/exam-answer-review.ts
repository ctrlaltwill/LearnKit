import type { GeneratedExamQuestion } from "./exam-generator-types";

export type ExamChoiceReview = { text: string; selected: boolean; correct: boolean };

/** Snapshot every option by index, preserving duplicate option labels. */
export function buildExamChoiceReview(question: GeneratedExamQuestion, answer: unknown): ExamChoiceReview[] {
  const correct = new Set(question.correctIndices?.length ? question.correctIndices : [question.correctIndex]);
  const selected = new Set(Array.isArray(answer) ? answer : typeof answer === "number" ? [answer] : []);
  return (question.options ?? []).map((text, index) => ({ text, selected: selected.has(index), correct: correct.has(index) }));
}
