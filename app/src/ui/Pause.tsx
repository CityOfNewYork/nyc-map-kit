/** A comma a screen reader hears and the screen does not show: between the lines of a
 *  list row, which are read as one button name, so each line is heard as its own phrase
 *  rather than run into the next. Punctuation only, so it needs no translation. */
export function Pause() {
  return <span className="visually-hidden">, </span>;
}
