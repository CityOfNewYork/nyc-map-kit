// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { site } from "../../test/fixtures.ts";
import { SiteRow } from "../../ui/SiteRow.tsx";
import { centerRow } from "./CenterRow.tsx";

afterEach(cleanup);

const bus = site("lincoln-bus", {
  org: "Lincoln Warming Bus", address: "234 East 149th Street, Bronx", type: "bus",
  opens: "22:00", closes: "05:00",
});

describe("a site's row", () => {
  test.each([
    ["a center's row", (f: typeof bus) => centerRow(f, 23 * 60)],
    ["the kit's own row", undefined],
  ])("%s shows the name and address as given: English, and not for translating", (_, row) => {
    render(<SiteRow feature={bus} row={row} onClick={() => {}} />);
    for (const text of ["Lincoln Warming Bus", "234 East 149th Street, Bronx"]) {
      expect(screen.getByText(text)).toHaveAttribute("lang", "en");
      expect(screen.getByText(text)).toHaveAttribute("translate", "no");
    }
  });
});
