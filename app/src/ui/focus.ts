/**
 * focus.ts — moving focus for the reader, with the focus ring for a keyboard only.
 *
 * The kit moves focus itself when what the reader asked for appears: a card's heading,
 * the filters' heading, the map's heading after a search, the button that opened what
 * just closed. A browser decides by its own guess whether to draw the ring on such a
 * move, and Safari on a phone guesses yes after a tap. `moveFocus` decides instead: the
 * ring shows when the reader's last input was a key, as it does when they Tab, and not
 * after a tap or a click. A browser without the `focusVisible` option ignores it and
 * guesses as before.
 *
 * The last input is also on the page, as <html data-input="key"> or "pointer", for CSS.
 * A text box draws its ring whenever it has focus, a click included, so the stylesheet
 * leaves the search box's ring off after a pointer.
 */

let byKeyboard = false;

/** The keys that move focus on from a text box, and so are keyboard use inside one. */
const LEAVES_FIELD = new Set(["Tab", "Escape"]);

function lastInput(key: boolean): void {
  byKeyboard = key;
  document.documentElement.dataset.input = key ? "key" : "pointer";
}

addEventListener("keydown", (e) => {
  // A modifier on its own, such as the Cmd of a screenshot, is not moving focus, and
  // typing into a text box is not moving around the page.
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const inTextBox = e.target instanceof HTMLInputElement && e.target.type === "text";
  if (inTextBox && !LEAVES_FIELD.has(e.key)) return;
  lastInput(true);
}, true);
addEventListener("pointerdown", () => lastInput(false), true);

/** Focus `el`, with the ring only when the reader's last input was a key. */
export function moveFocus(el: HTMLElement | null | undefined): void {
  el?.focus({ focusVisible: byKeyboard });
}
