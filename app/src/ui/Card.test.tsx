// @vitest-environment jsdom

import { describe, test } from "vitest";

// TODOs mark planned coverage; replace each with a rendered interaction test.
describe("Card", () => {
  test.todo("renders configured phone, website, and map actions with correct destinations");
  // Render a configured site; assert tel/http links and external-link target/rel attributes.

  test.todo("records analytics when a resident activates an action");
  // Click each action; assert window.dataLayer receives the event and site/org identifiers.

  test.todo("renders configured detail fields and omits empty values");
  // Render populated and empty site/org fields; assert visible labels and values, no empty rows.

  test.todo("renders structured field content accessibly");
  // Provide paragraph/list-style prose; assert paragraphs and list items rather than raw markup.
});
