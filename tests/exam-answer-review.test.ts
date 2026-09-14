import { describe, expect, it } from "vitest";
import { buildExamChoiceReview } from "../src/views/exam-generator/exam-answer-review";
import type { GeneratedExamQuestion } from "../src/views/exam-generator/exam-generator-types";
const question: GeneratedExamQuestion = { id: "q", type: "mcq", prompt: "Primes?", sourcePath: "", options: ["2", "4", "5"], correctIndices: [0, 2] };
describe("answer review snapshots", () => {
  it("distinguishes correct, incorrect and missed selections", () => {
    expect(buildExamChoiceReview(question, [0, 1])).toEqual([
      { text: "2", selected: true, correct: true },
      { text: "4", selected: true, correct: false },
      { text: "5", selected: false, correct: true },
    ]);
  });
  it("marks unanswered questions without inventing a selection", () => {
    expect(buildExamChoiceReview(question, undefined).every(c => !c.selected)).toBe(true);
  });
  it("supports single answers and duplicate labels by index", () => {
    expect(buildExamChoiceReview({ ...question, options: ["same", "same"], correctIndices: undefined, correctIndex: 0 }, 1)).toEqual([
      { text: "same", selected: false, correct: true },
      { text: "same", selected: true, correct: false },
    ]);
  });
});
