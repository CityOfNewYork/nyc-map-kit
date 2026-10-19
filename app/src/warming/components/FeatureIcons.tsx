// Open hours, wheelchair access and pets, as the card's meta line and the filters show them.
// Decorative: the text beside each says what it means.

export function WheelchairIcon() {
  return (
    <svg className="card-meta-icon" aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
      <circle cx="12.5" cy="3.8" r="2" fill="currentColor" />
      <path d="M11.5 7.5v6h5l2.5 5.5M11.5 10.5h4.5" fill="none" stroke="currentColor"
            strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.6 10.6a6 6 0 1 0 7.9 8" fill="none" stroke="currentColor" strokeWidth="2.2"
            strokeLinecap="round" />
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
