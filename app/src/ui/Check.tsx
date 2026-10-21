import { useId } from "react";
import type { ReactNode } from "react";

interface CheckProps {
  className: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Drawn between the box and the text, hidden from screen readers. */
  icon?: ReactNode;
  children: ReactNode;
}

/**
 * A checkbox inside its label, with the label's text as its name. The text is named by id
 * and hidden from screen readers: VoiceOver otherwise reads the checkbox ("Open now,
 * unchecked, checkbox") and then steps onto the same text again ("Open now"). It stays
 * on screen, so the label still toggles the box when clicked and is still translated.
 */
export function Check({ className, checked, onChange, icon, children }: CheckProps) {
  const id = useId();
  return (
    <label className={className}>
      <input type="checkbox" checked={checked} aria-labelledby={id}
             onChange={(e) => onChange(e.target.checked)} />
      {icon}
      <span id={id} aria-hidden="true">{children}</span>
    </label>
  );
}
