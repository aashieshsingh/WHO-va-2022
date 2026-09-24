/** @vitest-environment jsdom */

import React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { whoVa2022Instrument, type InstrumentQuestion } from "../src/index.js";
import { WhoVaQuestionControls } from "../src/web.js";

function getQuestion(name: string): InstrumentQuestion {
  const question = whoVa2022Instrument.questions.find((candidate) => candidate.name === name);

  if (!question) {
    throw new Error(`Missing question ${name}`);
  }

  return question;
}

describe("WHO VA dropdown controls", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it.each([
    ["Id10019", "female"],
    ["Id10058", "home"]
  ])("renders %s as an initially blank dropdown", async (name, answer) => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onAnswer = vi.fn();

    root.render(
      <WhoVaQuestionControls.SingleChoice
        data={{}}
        issues={[]}
        locale="en"
        onAnswer={onAnswer}
        question={getQuestion(name)}
        value={undefined}
      />
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const select = container.querySelector<HTMLSelectElement>(`select[data-testid="question-${name}"]`);
    expect(select).not.toBeNull();
    expect(select?.value).toBe("");
    expect(container.querySelector('[role="radio"]')).toBeNull();

    if (!select) {
      throw new Error(`Missing dropdown for ${name}`);
    }

    select.value = answer;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(onAnswer).toHaveBeenCalledWith(answer));

    root.unmount();
  });
});
