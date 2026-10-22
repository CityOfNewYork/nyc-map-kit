/**
 * The prototype note above the page (index.html, warming.html): plain HTML outside React,
 * wired here.
 */

/** The note's ×: removes the note until the page loads again, and the page takes its
 *  height. Focus moves to the page's <h1>, which a screen reader then reads out, rather
 *  than being left on the button that is gone. */
export function wireNoteClose() {
  const note = document.querySelector(".prototype-note");
  note?.querySelector(".note-close")?.addEventListener("click", () => {
    note.remove();
    document.querySelector<HTMLElement>("h1[tabindex]")?.focus();
  });
}
