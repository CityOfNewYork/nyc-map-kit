// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { Check } from "./Check.tsx";

afterEach(cleanup);

describe("Check", () => {
  test("names the checkbox by its text and hides the text from screen readers", () => {
    render(<Check className="pill" checked={false} onChange={() => {}}>Open now</Check>);
    expect(screen.getByRole("checkbox")).toHaveAccessibleName("Open now");
    expect(screen.getByText("Open now")).toHaveAttribute("aria-hidden", "true");
  });

  test("toggles when its text is clicked", () => {
    const onChange = vi.fn();
    render(<Check className="pill" checked={false} onChange={onChange}>Open now</Check>);
    fireEvent.click(screen.getByText("Open now"));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
