/** A category's mark for a list or a key: a circle in its colour with its glyph (SVG path
 *  data on a 24-unit square) in white, the glyph its pins carry on the map — stroked, or
 *  filled when `fill` (see core/pins.ts), or the default pin's hole when there is none.
 *  Hidden from screen readers: the text beside it says the same. */
export function CategoryIcon({ color, glyph, fill = false }: {
  color: string; glyph?: string; fill?: boolean;
}) {
  return (
    <svg className="category-icon" aria-hidden="true" viewBox="0 0 24 24" width="24" height="24">
      <circle cx="12" cy="12" r="12" fill={color} />
      {!glyph ? (
        <circle cx="12" cy="12" r="4" fill="#ffffff" />
      ) : fill ? (
        <path d={glyph} transform="translate(5 5) scale(0.583)" fill="#ffffff"
              fillRule="evenodd" />
      ) : (
        <path d={glyph} transform="translate(5 5) scale(0.583)" fill="none" stroke="#ffffff"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}
