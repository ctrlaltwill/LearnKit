// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("obsidian");
  return {
    ...actual,
    setIcon: () => {},
  };
});

import { createGroupPickerField } from "../src/platform/card-editor/card-editor";

describe("group picker badges", () => {
  it("renders separate badges in alphabetical order and joins only hierarchy segments", () => {
    const plugin = {
      store: {
        getAllCards: () => [],
      },
    } as any;

    const field = createGroupPickerField("Clinical Tests, Musculoskeletal, A::C", 1, plugin);
    document.body.appendChild(field.element);

    const badges = Array.from(field.element.querySelectorAll(".learnkit-badge-inline > span:first-child"))
      .map((el) => el.textContent);

    expect(badges).toEqual(["A / C", "Clinical Tests", "Musculoskeletal"]);

    field.element.remove();
  });

  it("shows selected groups first in alphabetical order", () => {
    const plugin = {
      store: {
        getAllCards: () => [
          { groups: ["Cardiology", "Pain Medicine"] },
          { groups: ["Anaesthesia", "Opioids"] },
          { groups: ["Emergency Medicine"] },
        ],
      },
    } as any;

    const field = createGroupPickerField("Pain Medicine, Opioids", 1, plugin);
    document.body.appendChild(field.element);

    field.element.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const labels = Array.from(field.element.querySelectorAll('.learnkit-group-picker-results [role="menuitem"] > span:first-child'))
      .map((el) => el.textContent);

    expect(labels).toEqual([
      "Opioids",
      "Pain Medicine",
      "Anaesthesia",
      "Cardiology",
      "Emergency Medicine",
    ]);

    field.element.remove();
  });
});