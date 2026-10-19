/**
 * i18n.ts — the interface's language: which one, and its words.
 *
 * The languages are New York State's twelve most common non-English languages among
 * New Yorkers with limited English (Executive Law § 202-a), a superset of the City's ten
 * designated citywide languages (Local Law 30 of 2017), and English. Chinese is offered
 * in both scripts, as nyc.gov offers it.
 *
 * The language is settled once, before the first render (see `chooseLanguage`), and
 * changing it loads the page again with `?lang=`, so nothing here re-renders. The words
 * live in src/i18n/<code>.json, keyed by the English text; a string with no translation
 * shows in English. `{name}` in a string is filled in by `t`'s second argument.
 */

export interface Language {
  code: string;
  /** The language's name in itself, as a picker lists it. */
  name: string;
}

/** English first, then by their names in English. */
export const LANGUAGES: Language[] = [
  { code: "en", name: "English" },
  { code: "ar", name: "العربية" },
  { code: "bn", name: "বাংলা" },
  { code: "zh-Hans", name: "简体中文" },
  { code: "zh-Hant", name: "繁體中文" },
  { code: "fr", name: "Français" },
  { code: "ht", name: "Kreyòl Ayisyen" },
  { code: "it", name: "Italiano" },
  { code: "ko", name: "한국어" },
  { code: "pl", name: "Polski" },
  { code: "ru", name: "Русский" },
  { code: "es", name: "Español" },
  { code: "ur", name: "اردو" },
  { code: "yi", name: "ייִדיש" },
];

/** Written right to left. */
const RTL = new Set(["ar", "ur", "yi"]);

/** Other spellings of a language, such as nyc.gov's own codes in its translated addresses. */
const ALIASES: Record<string, string> = {
  "zh": "zh-Hans", "zh-cn": "zh-Hans", "zh-ch": "zh-Hans", "zh-hans": "zh-Hans",
  "zh-sg": "zh-Hans", "zh-tw": "zh-Hant", "zh-hk": "zh-Hant", "zh-hant": "zh-Hant",
  "kr": "ko", "ji": "yi",
};

/** `raw` as one of LANGUAGES' codes, or null when it is none of them. */
export function supportedLanguage(raw: string | null | undefined): string | null {
  const value = (raw || "").trim().toLowerCase().replace(/_/g, "-");
  if (!value) return null;
  if (ALIASES[value]) return ALIASES[value];
  const exact = LANGUAGES.find((l) => l.code.toLowerCase() === value);
  if (exact) return exact.code;
  const base = value.split("-")[0];
  return ALIASES[base] ?? LANGUAGES.find((l) => l.code === base)?.code ?? null;
}

/**
 * The language to show, in priority order:
 *   1. `?lang=` in the page's address, which the picker and an embed code can set;
 *   2. a language in the path of the page that embeds this one, as nyc.gov's translated
 *      pages carry it. An embed sees that path only when its iframe sends it, with
 *      referrerpolicy="no-referrer-when-downgrade"; by default a browser sends another
 *      site only its origin;
 *   3. English.
 */
export function chooseLanguage(search: string, referrer: string): string {
  const asked = supportedLanguage(new URLSearchParams(search).get("lang"));
  if (asked) return asked;
  try {
    for (const segment of new URL(referrer).pathname.split("/")) {
      const found = supportedLanguage(segment);
      if (found && segment.length <= 7) return found;
    }
  } catch {
    // No referrer, or not a URL.
  }
  return "en";
}

type Entry = string | Partial<Record<Intl.LDMLPluralRule, string>>;

let current = "en";
let words: Record<string, Entry> = {};

const LOADERS = import.meta.glob<{ default: Record<string, Entry> }>("../i18n/*.json");

/** Load `code`'s words and mark the page as written in it: `<html lang>` and `dir`.
 *  Resolves once the words are in; English has none to load. */
export async function loadLanguage(code: string): Promise<void> {
  current = code;
  document.documentElement.lang = code;
  document.documentElement.dir = RTL.has(code) ? "rtl" : "ltr";
  const load = LOADERS[`../i18n/${code}.json`];
  words = load ? (await load()).default : {};
}

/** The language being shown. */
export function language(): string {
  return current;
}

/** `{name}` in `text` filled in from `vars`. */
function fill(text: string, vars?: Record<string, string | number>): string {
  return vars ? text.replace(/\{(\w+)\}/g, (all, key) => (key in vars ? String(vars[key]) : all))
    : text;
}

/** `text` in the language being shown, or in English when it has no translation. */
export function t(text: string, vars?: Record<string, string | number>): string {
  const entry = words[text];
  return fill(typeof entry === "string" ? entry : text, vars);
}

/**
 * The form of a phrase that counts `n` things: English's `one` or `other`, or the
 * translation's own form for `n` (Russian, Polish and Arabic have more than two). `{n}` in
 * it is `n`, written as the language writes numbers. A translation is keyed by `other`.
 */
export function plural(
  n: number, one: string, other: string, vars?: Record<string, string | number>,
): string {
  const entry = words[other];
  const all = { n: number(n), ...vars };
  if (typeof entry === "string") return fill(entry, all);
  if (entry) {
    const form = entry[new Intl.PluralRules(current).select(n)] ?? entry.other;
    if (form) return fill(form, all);
  }
  return fill(n === 1 ? one : other, all);
}

/** The text of each element under `root` marked `data-t`, translated: the plain HTML a page
 *  shows before the app renders. */
export function translateMarked(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>("[data-t]")) {
    el.textContent = t(el.textContent?.trim() ?? "");
  }
}

/** `n` as the language being shown writes numbers. */
export function number(n: number, fractionDigits = 0): string {
  return new Intl.NumberFormat(current,
    { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }).format(n);
}
