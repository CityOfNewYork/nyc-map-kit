import { useSyncExternalStore } from "react";
import { language, onLanguageChange } from "../logic/i18n.ts";

/** The interface's language, re-rendering the component that asks when it changes, and
 *  with it everything under it (see logic/i18n.ts). */
export function useLanguage(): string {
  return useSyncExternalStore(onLanguageChange, language);
}
