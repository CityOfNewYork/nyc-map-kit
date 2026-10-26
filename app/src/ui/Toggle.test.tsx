// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, test } from "vitest";
import { Toggle } from "./Toggle.tsx";

afterEach(cleanup);

function OpenNow() {
  const [on, setOn] = useState(false);
  return <Toggle className="pill" pressed={on} onChange={setOn}>Open now</Toggle>;
}

describe("Toggle", () => {
  test("is a button named by its text, its drawn box hidden from screen readers", () => {
    const { container } = render(<OpenNow />);
    expect(screen.getByRole("button", { name: "Open now" }))
      .toHaveAttribute("aria-pressed", "false");
    expect(container.querySelector(".toggle-box")).toHaveAttribute("aria-hidden", "true");
  });

  test("toggles with a click, with Enter and with Space", async () => {
    const user = userEvent.setup();
    render(<OpenNow />);
    const button = screen.getByRole("button", { name: "Open now" });

    await user.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    await user.keyboard("{Enter}");
    expect(button).toHaveAttribute("aria-pressed", "false");
    await user.keyboard(" ");
    expect(button).toHaveAttribute("aria-pressed", "true");
  });
});
