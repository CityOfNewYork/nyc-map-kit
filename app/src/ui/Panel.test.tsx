// @vitest-environment jsdom

import { describe, test } from "vitest";

// TODOs mark planned coverage; replace each with a rendered interaction test.
describe("Panel", () => {
  test.todo("renders one keyboard-operable row for every site");
  // Arrange a model with multiple sites; assert each row exposes its organization and address.

  test.todo("shows organization and site counts, including singular wording");
  // Arrange models with one and multiple records; assert the visible count labels.

  test.todo("omits site rows when list is off");
  // Render with list="off"; assert the panel has no site buttons but the count remains available.

  test.todo("opens the selected site from its row");
  // Click a row; assert onOpen receives that row's button element and matching feature.

  test.todo("cycles the mobile sheet through collapsed, half, and full states");
  // Click the sheet handle three times; assert aria-expanded and the rendered sheet state each time.
});
