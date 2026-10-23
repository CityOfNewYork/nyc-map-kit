// Open hours, wheelchair access and pets, as the card's meta line and the filters show them.
// Decorative: the text beside each says what it means.

/** The Accessible Icon (accessibleicon.org, public domain): the figure leans forward, in
 *  motion. Its paths, rescaled to the 24-unit square. */
export function WheelchairIcon() {
  return (
    <svg className="card-meta-icon" aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"
         fill="currentColor">
      <circle cx="17.27" cy="3.99" r="1.99" />
      <path d="M19.47 11.07c-.24-.25-.57-.38-.92-.36l-4.14.23l2.28-2.6c.32-.37.42-.86.29-1.3c-.07-.3-.25-.58-.53-.75c-.01-.01-5.45-3.17-5.45-3.17c-.44-.26-1-.2-1.39.14l-2.66 2.37c-.49.44-.53 1.19-.1 1.68c.44.49 1.19.53 1.68.1l2.02-1.8l1.67.97l-2.94 3.35c-1.22.2-2.32.76-3.18 1.57l1.54 1.54c.69-.63 1.62-1.02 2.63-1.02c2.15 0 3.91 1.75 3.91 3.91c0 1.01-.39 1.93-1.02 2.63l1.54 1.54c1.02-1.09 1.65-2.55 1.65-4.16c0-.96-.22-1.87-.62-2.67l1.6-.09l-.39 4.79c-.05.65.43 1.23 1.09 1.28c.03 0 .07 0 .1 0c.61 0 1.13-.47 1.18-1.09l.5-6.14C19.83 11.65 19.71 11.31 19.47 11.07z" />
      <path d="M10.27 19.83c-2.15 0-3.91-1.75-3.91-3.91c0-.81.25-1.57.67-2.19l-1.55-1.55c-.81 1.03-1.29 2.33-1.29 3.74c0 3.36 2.72 6.08 6.08 6.08c1.41 0 2.71-.48 3.74-1.29l-1.55-1.55C11.83 19.58 11.08 19.83 10.27 19.83z" />
    </svg>
  );
}

export function PawIcon() {
  return (
    <svg className="card-meta-icon" aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"
         fill="currentColor">
      <ellipse cx="6" cy="10" rx="2.2" ry="2.8" />
      <ellipse cx="18" cy="10" rx="2.2" ry="2.8" />
      <ellipse cx="9.5" cy="5.5" rx="2.2" ry="2.8" />
      <ellipse cx="14.5" cy="5.5" rx="2.2" ry="2.8" />
      <path d="M12 11.5c-3 0-6 4.5-6 7a2.5 2.5 0 0 0 3.5 2.2c1.6-.6 3.4-.6 5 0A2.5 2.5 0 0 0 18 18.5c0-2.5-3-7-6-7z" />
    </svg>
  );
}

export function ClockIcon() {
  return (
    <svg className="card-meta-icon" aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path d="M12 7.2V12l3.3 2.4" fill="none" stroke="currentColor" strokeWidth="2.2"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
