import type { ReactNode } from "react";

interface ToggleProps {
  className: string;
  pressed: boolean;
  onChange: (pressed: boolean) => void;
  /** Drawn between the box and the text, hidden from screen readers. */
  icon?: ReactNode;
  children: ReactNode;
}

/**
 * A toggle button (WAI-ARIA APG button pattern): a <button aria-pressed>, so Enter and
 * Space both toggle it and screen readers read it as "Open now, toggle button, pressed".
 * Check is the checkbox for a control that looks like one. A checkbox cannot sit inside
 * a button, so the box is drawn, and hidden from screen readers with the icon; the text
 * names the button.
 */
export function Toggle({ className, pressed, onChange, icon, children }: ToggleProps) {
  return (
    <button type="button" className={className} aria-pressed={pressed}
            onClick={() => onChange(!pressed)}>
      <svg className="toggle-box" aria-hidden="true" viewBox="0 0 18 18" width="18" height="18">
        <rect x="0.5" y="0.5" width="17" height="17" rx="2.5" />
        <path d="M4.5 9.5l3 3 6-7" />
      </svg>
      {icon}
      <span>{children}</span>
    </button>
  );
}
