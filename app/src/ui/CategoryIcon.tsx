/** A category's mark for a list or a key: a circle in its colour with its glyph (SVG path
 *  data on a 24-unit square) in white, the glyph its pins carry on the map. Hidden from
 *  screen readers: the text beside it says the same. */
export function CategoryIcon({ color, glyph }: { color: string; glyph: string }) {
  return (
    <svg className="category-icon" aria-hidden="true" viewBox="0 0 24 24" width="24" height="24">
      <circle cx="12" cy="12" r="12" fill={color} />
      <path d={glyph} transform="translate(5 5) scale(0.583)" fill="none" stroke="#ffffff"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
