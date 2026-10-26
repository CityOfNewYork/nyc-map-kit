// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from "vitest";
import {
  chooseLanguage, language, loadLanguage, number, onLanguageChange, plural, supportedLanguage, t,
  translateMarked,
} from "./i18n.ts";

afterEach(() => loadLanguage("en"));

describe("supportedLanguage", () => {
  test("matches a code whatever its case, spacing or separator", () => {
    expect(supportedLanguage("es")).toBe("es");
    expect(supportedLanguage(" ES ")).toBe("es");
    expect(supportedLanguage("ZH-HANT")).toBe("zh-Hant");
    expect(supportedLanguage("zh_TW")).toBe("zh-Hant");
  });
  test("reads other spellings, such as nyc.gov's own codes", () => {
    expect(supportedLanguage("zh-cn")).toBe("zh-Hans");
    expect(supportedLanguage("kr")).toBe("ko");
    expect(supportedLanguage("ji")).toBe("yi");
  });
  test("falls back from a region to its language", () => {
    expect(supportedLanguage("es-419")).toBe("es");
    expect(supportedLanguage("fr-CA")).toBe("fr");
  });
  test("is null for a language not offered, or none", () => {
    for (const raw of ["pt", "site", "", null, undefined]) expect(supportedLanguage(raw)).toBeNull();
  });
});

describe("chooseLanguage", () => {
  test("?lang= comes first", () => {
    expect(chooseLanguage("?lang=fr", "https://www.nyc.gov/es/site/em/index.page")).toBe("fr");
  });
  test("then a language in the path of the page that embeds the map", () => {
    expect(chooseLanguage("", "https://www.nyc.gov/es/site/em/index.page")).toBe("es");
    expect(chooseLanguage("?lang=pt", "https://www.nyc.gov/zh-tw/site/em/index.page"))
      .toBe("zh-Hant");
  });
  test("a longer path segment that starts with a code is not a language", () => {
    expect(chooseLanguage("", "https://example.org/fr-ny-events/map.html")).toBe("en");
  });
  test("then English, including for a referrer that is missing or not a URL", () => {
    expect(chooseLanguage("", "https://www.nyc.gov/site/em/index.page")).toBe("en");
    expect(chooseLanguage("", "")).toBe("en");
    expect(chooseLanguage("", "not a url")).toBe("en");
  });
});

describe("loadLanguage", () => {
  test("marks the page with the language and its direction", async () => {
    await loadLanguage("ar");
    expect(language()).toBe("ar");
    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
    await loadLanguage("es");
    expect(document.documentElement.dir).toBe("ltr");
  });
  test("tells each listener, until it stops listening", async () => {
    const listener = vi.fn();
    const stop = onLanguageChange(listener);
    await loadLanguage("es");
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    await loadLanguage("en");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("t", () => {
  test("fills in {names}, and leaves a name it is not given", () => {
    expect(t("{miles} mi away", { miles: 2 })).toBe("2 mi away");
    expect(t("{miles} mi away")).toBe("{miles} mi away");
    expect(t("{miles} mi away", { km: 3 })).toBe("{miles} mi away");
  });
  test("shows the translation, or the English when there is none", async () => {
    await loadLanguage("es");
    expect(t("Address")).toBe("Dirección");
    expect(t("{miles} mi away", { miles: "1.5" })).toBe("a 1.5 mi");
    expect(t("A string with no translation")).toBe("A string with no translation");
  });
});

describe("plural", () => {
  test("uses English's one and other, with the number written English's way", () => {
    expect(plural(1, "{n} site", "{n} sites")).toBe("1 site");
    expect(plural(0, "{n} site", "{n} sites")).toBe("0 sites");
    expect(plural(1234, "{n} site", "{n} sites")).toBe("1,234 sites");
  });
  test("uses a translation's own forms", async () => {
    await loadLanguage("ru");
    expect(plural(1, "{n} site", "{n} sites")).toBe("1 место");
    expect(plural(3, "{n} site", "{n} sites")).toBe("3 места");
    expect(plural(5, "{n} site", "{n} sites")).toBe("5 мест");
    expect(plural(21, "{n} site", "{n} sites")).toBe("21 место");
  });
});

describe("number", () => {
  test("writes numbers the language's way", async () => {
    expect(number(1234)).toBe("1,234");
    expect(number(1.24, 1)).toBe("1.2");
    await loadLanguage("es");
    expect(number(12345)).toBe("12.345");
    expect(number(1.24, 1)).toBe("1,2");
  });
});

describe("translateMarked", () => {
  test("translates marked HTML and keeps the English for the next change", async () => {
    const root = document.createElement("div");
    root.innerHTML = "<span data-t>Address</span><span>Hours</span>";
    await loadLanguage("es");
    translateMarked(root);
    expect(root.textContent).toBe("DirecciónHours");
    await loadLanguage("en");
    translateMarked(root);
    expect(root.textContent).toBe("AddressHours");
  });
});
