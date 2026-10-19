import { useState } from "react";

/**
 * The bar across the top of the page: the NYC wordmark, which is the page's heading for a
 * screen reader ("NYC Warming Centers"), and "Official website", which opens the line
 * every nyc.gov page carries to say it is the City's.
 */
export function TopBar() {
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <div className="header-bar">
        <h1>
          <span className="nyc-logo" aria-hidden="true">NYC</span>
          <span className="visually-hidden">NYC Warming Centers</span>
        </h1>
        <button type="button" className="official-toggle" aria-expanded={open}
                aria-controls="official-notice" onClick={() => setOpen((o) => !o)}>
          <span>Official website</span>
          <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14">
            <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <div className="official-notice" id="official-notice" hidden={!open}>
        <p>
          <strong>Official websites use nyc.gov.</strong>{" "}
          <span>An nyc.gov website belongs to an official New York City government organization.</span>
        </p>
      </div>
    </header>
  );
}
