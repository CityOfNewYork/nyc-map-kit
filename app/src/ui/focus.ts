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
 */

let byKeyboard = false;

addEventListener("keydown", (e) => {
  // A modifier on its own, such as the Cmd of a screenshot, is not moving focus.
  if (!e.metaKey && !e.ctrlKey && !e.altKey) byKeyboard = true;
}, true);
addEventListener("pointerdown", () => { byKeyboard = false; }, true);

/** Focus `el`, with the ring only when the reader's last input was a key. */
export function moveFocus(el: HTMLElement | null | undefined): void {
  el?.focus({ focusVisible: byKeyboard });
}
