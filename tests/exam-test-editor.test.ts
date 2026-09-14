import { describe, expect, it } from "vitest";
import { validateExamTestDraft, type ExamTestDraft } from "../src/views/exam-generator/exam-test-editor";
const tx = (_key: string, fallback: string) => fallback;
const valid = (): ExamTestDraft => ({ label: "Quiz", questions: [{ id: "q", type: "mcq", prompt: "Primes?", sourcePath: "", options: ["2", "4", "5"], correctIndices: [0, 2] }] });
describe("test editor validation", () => {
  it("accepts multi-answer and short-answer questions", () => {
    const draft = valid();
    draft.questions.push({ id: "saq", type: "saq", prompt: "Why?", sourcePath: "", markingGuide: ["A reason"] });
    expect(validateExamTestDraft(draft, tx)).toBeNull();
  });
  it("rejects missing names, questions, prompts and answer keys", () => {
    for (const mutate of [
      (d: ExamTestDraft) => { d.label = " "; },
      (d: ExamTestDraft) => { d.questions = []; },
      (d: ExamTestDraft) => { d.questions[0].prompt = " "; },
      (d: ExamTestDraft) => { d.questions[0].correctIndices = []; },
      (d: ExamTestDraft) => { d.questions[0].correctIndices = [3]; },
      (d: ExamTestDraft) => { d.questions[0].options = ["2", ""]; },
      (d: ExamTestDraft) => { d.questions.push({ ...d.questions[0] }); },
      (d: ExamTestDraft) => { d.questions[0].type = "saq"; },
    ]) {
      const draft = valid(); mutate(draft);
      expect(validateExamTestDraft(draft, tx)).not.toBeNull();
    }
  });
});
