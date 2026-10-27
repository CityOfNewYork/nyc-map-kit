// @vitest-environment jsdom

import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

/** The pages that carry the prototype note, as text. */
const html = import.meta.glob<string>("../../*.html", { query: "?raw", import: "default", eager: true });
const PAGES = ["index.html", "computer-centers.html", "snap.html", "warming.html",
  "wheelchair-friendly.html"];

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the prototype note", () => {
  test.each(PAGES)("is a region named by its first words, holding its close button: %s", (page) => {
    const doc = new DOMParser().parseFromString(html[`../../${page}`], "text/html");
    document.body.innerHTML = doc.body.innerHTML;
    const note = screen.getByRole("region", { name: /^Prototype/ });
    expect(note).toHaveClass("prototype-note");
    expect(within(note).getByRole("button", { name: "Close prototype notice" })).toBeInTheDocument();
  });
});
