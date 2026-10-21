// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { OpenStatusLine } from "../warming/components/OpenStatusLine.tsx";
import { Pause } from "./Pause.tsx";

afterEach(cleanup);

describe("Pause", () => {
  test("separates a row's lines in the button's accessible name", () => {
    render(
      <button type="button">
        <span className="name">Lincoln Warming Bus</span>
        <Pause />
        <span className="addr">234 East 149th Street, Bronx</span>
      </button>,
    );
    expect(screen.getByRole("button"))
      .toHaveAccessibleName(/^Lincoln Warming Bus,\s*234 East 149th Street, Bronx$/);
  });

  test("reads the hidden dot in a closed center's status as a pause", () => {
    render(
      <button type="button">
        <OpenStatusLine status={{ state: "closed", opens: 22 * 60 }} />
      </button>,
    );
    expect(screen.getByRole("button")).toHaveAccessibleName(/^Closed,\s*Opens at/);
  });
});
